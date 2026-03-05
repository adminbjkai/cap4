import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { completeUpload, createVideo, requestSignedUpload, uploadToSignedUrl, type UploadProgress } from "../lib/api";
import { formatBytes, formatDuration, formatEta } from "../lib/format";
import { upsertRecentSession } from "../lib/sessions";

type RecorderState =
  | "idle"
  | "requesting_permissions"
  | "ready"
  | "recording"
  | "stopping"
  | "preview"
  | "uploading"
  | "processing"
  | "complete"
  | "error";

type MicrophoneDevice = {
  deviceId: string;
  label: string;
};

type UploadAttemptContext = {
  videoId: string;
};

function stopStream(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function pickSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "video/webm";
  const candidates = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "video/webm";
}

export function RecordPage() {
  const navigate = useNavigate();

  const [state, setState] = useState<RecorderState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);

  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [uploadContext, setUploadContext] = useState<UploadAttemptContext | null>(null);

  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null);

  const displayStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micAnalyserDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const micMeterAnimationRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtMsRef = useRef<number | null>(null);
  const finalizedRef = useRef(false);
  const [micLevel, setMicLevel] = useState(0);
  const stateLabelMap: Record<RecorderState, string> = {
    idle: "Idle",
    requesting_permissions: "Requesting permissions",
    ready: "Ready",
    recording: "Recording",
    stopping: "Stopping",
    preview: "Preview",
    uploading: "Uploading",
    processing: "Processing",
    complete: "Complete",
    error: "Needs attention"
  };

  const unsupportedReason = useMemo(() => {
    if (typeof window === "undefined") return null;
    if (!navigator.mediaDevices?.getDisplayMedia) return "Screen recording is not supported in this browser.";
    if (!navigator.mediaDevices?.getUserMedia) return "Microphone access is not supported in this browser.";
    if (typeof MediaRecorder === "undefined") return "MediaRecorder is not supported in this browser.";
    return null;
  }, []);

  const refreshMicrophones = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices
      .filter((device) => device.kind === "audioinput")
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Microphone ${index + 1}`
      }));
    setMicrophones(mics);
    if (!selectedMicId && mics.length > 0) {
      setSelectedMicId(mics[0]!.deviceId);
    }
  }, [selectedMicId]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetLocalPreview = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setRecordedBlob(null);
    setSourceLabel(null);
    setSecondsElapsed(0);
    setUploadProgress(null);
    setVideoId(null);
    setJobId(null);
    setRetryAvailable(false);
    setUploadContext(null);
  }, [previewUrl]);

  const stopCameraPreview = useCallback(() => {
    stopStream(cameraStreamRef.current);
    cameraStreamRef.current = null;
    if (cameraPreviewRef.current) {
      cameraPreviewRef.current.srcObject = null;
    }
  }, []);

  const cleanupRecordingResources = useCallback(() => {
    clearTimer();
    if (micMeterAnimationRef.current !== null) {
      window.cancelAnimationFrame(micMeterAnimationRef.current);
      micMeterAnimationRef.current = null;
    }
    micAnalyserRef.current = null;
    micAnalyserDataRef.current = null;
    setMicLevel(0);
    stopStream(displayStreamRef.current);
    stopStream(micStreamRef.current);
    stopStream(recorderStreamRef.current);
    displayStreamRef.current = null;
    micStreamRef.current = null;
    recorderStreamRef.current = null;
    mediaRecorderRef.current = null;

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, [clearTimer]);

  const finalizeRecording = useCallback(
    (recorderMimeType: string) => {
      if (finalizedRef.current) return;
      finalizedRef.current = true;

      cleanupRecordingResources();

      const blob = new Blob(chunksRef.current, { type: recorderMimeType || "video/webm" });
      if (blob.size === 0) {
        setState("error");
        setErrorMessage(
          "Recording stopped before data was captured. Try again and share a tab/window for at least a moment."
        );
        return;
      }

      const nextPreviewUrl = URL.createObjectURL(blob);
      setRecordedBlob(blob);
      setPreviewUrl(nextPreviewUrl);
      setSourceLabel("Screen recording");
      setState("preview");
      setErrorMessage(null);
      setRetryAvailable(false);
    },
    [cleanupRecordingResources]
  );

  useEffect(() => {
    void refreshMicrophones();
  }, [refreshMicrophones]);

  useEffect(() => {
    if (!micEnabled) {
      setMicLevel(0);
    }
  }, [micEnabled]);

  useEffect(() => {
    return () => {
      cleanupRecordingResources();
      stopCameraPreview();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [cleanupRecordingResources, stopCameraPreview, previewUrl]);

  useEffect(() => {
    if (!cameraEnabled || state === "recording" || state === "stopping") {
      stopCameraPreview();
      return;
    }

    let cancelled = false;

    const startPreview = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (cancelled) {
          stopStream(stream);
          return;
        }
        cameraStreamRef.current = stream;
        if (cameraPreviewRef.current) {
          cameraPreviewRef.current.srcObject = stream;
        }
      } catch {
        if (!cancelled) {
          setErrorMessage("Camera preview unavailable. You can continue without camera preview.");
          setCameraEnabled(false);
        }
      }
    };

    void startPreview();

    return () => {
      cancelled = true;
      stopCameraPreview();
    };
  }, [cameraEnabled, state, stopCameraPreview]);

  const requestPermissionWarmup = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const temp = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stopStream(temp);
      await refreshMicrophones();
    } catch {
      // Best-effort preflight only.
    }
  }, [refreshMicrophones]);

  const startRecording = useCallback(async () => {
    if (unsupportedReason) {
      setState("error");
      setErrorMessage(unsupportedReason);
      return;
    }

    resetLocalPreview();
    setState("requesting_permissions");
    setErrorMessage(null);
    finalizedRef.current = false;

    try {
      await requestPermissionWarmup();

      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      displayStreamRef.current = displayStream;

      let micStream: MediaStream | null = null;
      if (micEnabled) {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true,
          video: false
        });
        micStreamRef.current = micStream;
      }

      const composedStream = new MediaStream();
      const videoTrack = displayStream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error("No video track available from screen capture.");
      }
      composedStream.addTrack(videoTrack);

      const sourceStreams: MediaStream[] = [];
      if (displayStream.getAudioTracks().length > 0) sourceStreams.push(displayStream);
      if (micStream && micStream.getAudioTracks().length > 0) sourceStreams.push(micStream);

      if (sourceStreams.length > 0) {
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        const destination = audioContext.createMediaStreamDestination();

        if (micStream && micStream.getAudioTracks().length > 0) {
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 2048;
          analyser.smoothingTimeConstant = 0.86;
          const analyserSource = audioContext.createMediaStreamSource(micStream);
          analyserSource.connect(analyser);
          micAnalyserRef.current = analyser;
          micAnalyserDataRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
        }

        for (const sourceStream of sourceStreams) {
          const source = audioContext.createMediaStreamSource(sourceStream);
          source.connect(destination);
        }
        const mixedTrack = destination.stream.getAudioTracks()[0];
        if (mixedTrack) {
          composedStream.addTrack(mixedTrack);
        }
      }

      recorderStreamRef.current = composedStream;

      const recorder = new MediaRecorder(composedStream, { mimeType: pickSupportedMimeType() });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setState("error");
        setErrorMessage("Recording failed unexpectedly. Try again, and if this repeats, refresh the page.");
      };

      recorder.onstop = () => {
        finalizeRecording(recorder.mimeType || "video/webm");
      };

      const handleNativeStop = () => {
        if (recorder.state === "recording") {
          setState("stopping");
          recorder.stop();
        }
      };

      for (const track of displayStream.getTracks()) {
        track.addEventListener("ended", handleNativeStop, { once: true });
      }

      startedAtMsRef.current = Date.now();
      clearTimer();
      timerRef.current = window.setInterval(() => {
        const startedAt = startedAtMsRef.current;
        if (!startedAt) return;
        setSecondsElapsed((Date.now() - startedAt) / 1000);
      }, 200);

      const animateMicMeter = () => {
        const analyser = micAnalyserRef.current;
        const data = micAnalyserDataRef.current;
        if (!analyser || !data) {
          setMicLevel(0);
          micMeterAnimationRef.current = window.requestAnimationFrame(animateMicMeter);
          return;
        }

        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i += 1) {
          const normalized = (data[i]! - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        const nextLevel = Math.max(0, Math.min(100, Math.round(rms * 240)));
        setMicLevel(nextLevel);
        micMeterAnimationRef.current = window.requestAnimationFrame(animateMicMeter);
      };
      if (micEnabled) {
        micMeterAnimationRef.current = window.requestAnimationFrame(animateMicMeter);
      }

      recorder.start(250);
      setState("recording");
    } catch (error) {
      cleanupRecordingResources();
      setState("error");
      const nextError =
        error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")
          ? "Permission was denied. Allow screen sharing and microphone access in your browser, then try again."
          : error instanceof DOMException && error.name === "NotFoundError"
            ? "No capture source or microphone was found. Connect a microphone or pick a shareable tab/window."
            : error instanceof Error
              ? error.message
              : "Unable to start recording. Try again.";
      setErrorMessage(nextError);
    }
  }, [unsupportedReason, resetLocalPreview, requestPermissionWarmup, micEnabled, selectedMicId, cleanupRecordingResources, clearTimer, finalizeRecording]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    setState("stopping");
    recorder.stop();
  }, []);

  const uploadAndProcess = useCallback(async () => {
    if (!recordedBlob) return;

    setState("uploading");
    setErrorMessage(null);

    try {
      let activeVideoId = uploadContext?.videoId ?? null;
      if (!activeVideoId) {
        const created = await createVideo();
        activeVideoId = created.videoId;
        setUploadContext({ videoId: activeVideoId });
      }
      setVideoId(activeVideoId);

      const signed = await requestSignedUpload(activeVideoId, recordedBlob.type || "application/octet-stream");

      await uploadToSignedUrl(signed.putUrl, recordedBlob, recordedBlob.type || "application/octet-stream", (progress) => {
        setUploadProgress(progress);
      });

      setState("processing");

      const completed = await completeUpload(activeVideoId);
      setJobId(completed.jobId);

      upsertRecentSession({
        videoId: activeVideoId,
        jobId: completed.jobId,
        createdAt: new Date().toISOString(),
        processingPhase: "queued",
        processingProgress: 0
      });

      setState("complete");
      setRetryAvailable(false);
      navigate(`/video/${activeVideoId}?jobId=${completed.jobId}`);
    } catch (error) {
      setState("error");
      setRetryAvailable(true);
      setErrorMessage(
        error instanceof Error
          ? `Upload failed. Check your connection and retry without re-recording. Details: ${error.message}`
          : "Upload failed. Check your connection and retry without re-recording."
      );
    }
  }, [recordedBlob, navigate, uploadContext]);

  const downloadRecording = useCallback(() => {
    if (!previewUrl) return;
    const a = document.createElement("a");
    a.href = previewUrl;
    a.download = `cap-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
    a.click();
  }, [previewUrl]);

  const handleExistingFileSelection = useCallback((file: File | null) => {
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const nextPreviewUrl = URL.createObjectURL(file);
    setRecordedBlob(file);
    setPreviewUrl(nextPreviewUrl);
    setSourceLabel(file.name);
    setState("preview");
    setErrorMessage(null);
    setRetryAvailable(false);
    setUploadContext(null);
  }, [previewUrl]);

  const resetAll = useCallback(() => {
    cleanupRecordingResources();
    setState("idle");
    setErrorMessage(null);
    resetLocalPreview();
  }, [cleanupRecordingResources, resetLocalPreview]);

  return (
    <div className="space-y-6">
      <section className="workspace-card">
        <p className="workspace-label">Capture</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">New recording</h1>
        <p className="mt-2 text-sm legacy-muted">Capture a screen, tab, or window with microphone audio, then preview and upload for processing.</p>

        {unsupportedReason ? <p className="panel-warning mt-4">{unsupportedReason}</p> : null}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="panel-subtle flex items-center justify-between">
            <span className="text-sm">Microphone</span>
            <input
              type="checkbox"
              checked={micEnabled}
              onChange={(e) => setMicEnabled(e.target.checked)}
              className="h-4 w-4 accent-accent-600"
            />
          </label>

          <label className="panel-subtle flex items-center justify-between">
            <span className="text-sm">Camera preview (optional)</span>
            <input
              type="checkbox"
              checked={cameraEnabled}
              onChange={(e) => setCameraEnabled(e.target.checked)}
              className="h-4 w-4 accent-accent-600"
            />
          </label>
        </div>

        <div className="panel-subtle mt-3">
          <label htmlFor="micSelect" className="field-label">
            Microphone source
          </label>
          <select
            id="micSelect"
            value={selectedMicId}
            onChange={(e) => setSelectedMicId(e.target.value)}
            className="input-control"
            disabled={!micEnabled}
          >
            {microphones.length === 0 ? <option value="">No microphone found</option> : null}
            {microphones.map((mic) => (
              <option key={mic.deviceId} value={mic.deviceId}>
                {mic.label}
              </option>
            ))}
          </select>
        </div>

        <div className="panel-subtle mt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="field-label mb-0">Mic confidence</span>
            <span className="text-xs text-muted">{micEnabled ? `${micLevel}%` : "Off"}</span>
          </div>
          <div className="progress-track h-2 overflow-hidden rounded-full">
            <div
              className="h-full rounded-full bg-accent-600 transition-all duration-150"
              style={{ width: `${micEnabled ? micLevel : 0}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            Speak before recording to verify microphone activity. You should see the meter react.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {state !== "recording" ? (
            <button
              type="button"
                onClick={() => void startRecording()}
                className="btn-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={state === "requesting_permissions" || !!unsupportedReason}
              >
              {state === "requesting_permissions" ? "Requesting permissions…" : "Start"}
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              className="btn-tertiary px-4 py-2"
            >
              Stop
            </button>
          )}

          <button
            type="button"
            onClick={resetAll}
            className="btn-secondary px-4 py-2"
          >
            Reset
          </button>

          <span className="panel-subtle text-sm font-medium">Timer: {formatDuration(secondsElapsed)}</span>
          <span className="panel-subtle text-sm font-medium">State: {stateLabelMap[state]}</span>
        </div>

        {errorMessage ? <p className="panel-danger mt-4">{errorMessage}</p> : null}

        {cameraEnabled ? (
          <div className="mt-4">
            <p className="field-label">Camera preview</p>
            <video ref={cameraPreviewRef} autoPlay muted playsInline className="video-frame max-h-48 rounded-lg" />
          </div>
        ) : null}
      </section>

      <section className="workspace-card">
        <h2 className="text-base font-semibold">Preview and upload</h2>

        <div className="panel-subtle mt-3 p-3">
          <label htmlFor="existingVideo" className="field-label">
            Or choose a local file
          </label>
          <input
            id="existingVideo"
            type="file"
            accept="video/*"
            className="input-control block"
            onChange={(e) => handleExistingFileSelection(e.currentTarget.files?.[0] ?? null)}
          />
        </div>

        {!previewUrl ? (
          <p className="mt-2 text-sm legacy-muted">Stop a recording to preview it here, or choose a local file.</p>
        ) : (
          <>
            {sourceLabel ? <p className="mt-3 text-sm legacy-muted">Selected source: {sourceLabel}</p> : null}
            <video controls src={previewUrl} className="video-frame mt-3 w-full rounded-lg" />
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void uploadAndProcess()}
                className="btn-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={state === "uploading" || state === "processing"}
              >
                {state === "uploading" ? "Uploading…" : state === "processing" ? "Queued for processing…" : "Upload recording"}
              </button>
              {retryAvailable ? (
                <button
                  type="button"
                  onClick={() => void uploadAndProcess()}
                  className="btn-tertiary px-4 py-2"
                >
                  Retry upload
                </button>
              ) : null}
              <button
                type="button"
                onClick={downloadRecording}
                className="btn-secondary px-4 py-2"
              >
                Save local recording
              </button>
            </div>
          </>
        )}

        {uploadProgress ? (
          <div className="panel-subtle mt-4 p-3">
            <div className="progress-track mb-2 h-2 w-full rounded-full">
              <div
                className="h-full rounded-full bg-accent-600 transition-all"
                style={{ width: `${Math.max(0, Math.min(100, uploadProgress.progressPct))}%` }}
              />
            </div>
            <p className="text-sm">Upload: {uploadProgress.progressPct}% ({formatBytes(uploadProgress.loadedBytes)} / {formatBytes(uploadProgress.totalBytes)})</p>
            <p className="text-xs text-muted">
              Speed: {formatBytes(uploadProgress.speedBytesPerSec)}/s · ETA: {formatEta(uploadProgress.etaSeconds)}
            </p>
          </div>
        ) : null}

        {videoId ? (
          <p className="mt-3 text-sm legacy-muted">Video ID: <span className="font-mono text-xs">{videoId}</span></p>
        ) : null}
        {jobId ? <p className="text-sm legacy-muted">Job ID: <span className="font-mono text-xs">{jobId}</span></p> : null}
      </section>
    </div>
  );
}
