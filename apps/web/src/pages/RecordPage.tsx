import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { completeUpload, createVideo, requestSignedUpload, uploadMultipart, uploadToSignedUrl, type UploadProgress } from "../lib/api";
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

const MULTIPART_UPLOAD_THRESHOLD_BYTES = 100 * 1024 * 1024;

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
  const lastProgressUpdateRef = useRef<number>(0);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [uploadContext, setUploadContext] = useState<UploadAttemptContext | null>(null);

  const autoUploadTriggeredRef = useRef(false);
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
      const contentType = recordedBlob.type || "application/octet-stream";
      const onProgress = (progress: UploadProgress) => {
        const now = Date.now();
        // Throttle updates to 200ms or 100% progress
        if (now - lastProgressUpdateRef.current > 200 || progress.progressPct >= 100) {
          setUploadProgress(progress);
          lastProgressUpdateRef.current = now;
        }
      };

      let nextJobId: number | null = null;

      if (recordedBlob.size > MULTIPART_UPLOAD_THRESHOLD_BYTES) {
        nextJobId = await uploadMultipart(activeVideoId, recordedBlob, contentType, onProgress);
      } else {
        const signed = await requestSignedUpload(activeVideoId, contentType);
        await uploadToSignedUrl(signed.putUrl, recordedBlob, contentType, onProgress);

        setState("processing");

        const completed = await completeUpload(activeVideoId);
        nextJobId = completed.jobId;
      }

      setState("processing");
      setJobId(nextJobId);

      upsertRecentSession({
        videoId: activeVideoId,
        jobId: nextJobId ?? undefined,
        createdAt: new Date().toISOString(),
        processingPhase: "queued",
        processingProgress: 5
      });

      setState("complete");
      setRetryAvailable(false);
      navigate(nextJobId ? `/video/${activeVideoId}?jobId=${nextJobId}` : `/video/${activeVideoId}`);
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

  // Auto-upload recordings immediately after capture completes (not file selections)
  useEffect(() => {
    if (state === "preview" && recordedBlob && sourceLabel === "Screen recording" && !autoUploadTriggeredRef.current) {
      autoUploadTriggeredRef.current = true;
      void uploadAndProcess();
    }
    if (state !== "preview") {
      autoUploadTriggeredRef.current = false;
    }
  }, [state, recordedBlob, sourceLabel, uploadAndProcess]);

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

  const activeStep = state === "complete" ? 3 : state === "preview" || state === "uploading" || state === "processing" ? 2 : 1;

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <section className="workspace-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="workspace-label">Capture studio</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Record or upload</h1>
            <p className="mt-2 max-w-2xl text-sm text-hint">
              Capture a screen, tab, or window with microphone audio, then preview and hand it off to the processing pipeline.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { id: 1, label: "Setup", copy: "Choose sources" },
              { id: 2, label: "Preview", copy: "Review output" },
              { id: 3, label: "Upload", copy: "Auto-queued" }
            ].map((step) => {
              const isActive = activeStep === step.id;
              const isComplete = activeStep > step.id;
              return (
                <div
                  key={step.id}
                  className={`studio-step ${isActive ? "studio-step-active" : isComplete ? "studio-step-complete" : ""}`}
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">Step {step.id}</p>
                  <p className="mt-1 text-sm font-semibold">{step.label}</p>
                  <p className="mt-1 text-xs text-muted">{step.copy}</p>
                </div>
              );
            })}
          </div>
        </div>

        {unsupportedReason ? <p className="panel-warning mt-4">{unsupportedReason}</p> : null}
        {errorMessage ? <p className="panel-danger mt-4">{errorMessage}</p> : null}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <section className="workspace-card animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="workspace-label">Capture setup</p>
              <h2 className="text-xl font-semibold tracking-tight">Inputs and controls</h2>
            </div>
            <span className="status-chip">{stateLabelMap[state]}</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="panel-subtle flex items-center justify-between">
              <span className="text-sm font-medium">Microphone</span>
              <input
                type="checkbox"
                checked={micEnabled}
                onChange={(e) => setMicEnabled(e.target.checked)}
                className="h-4 w-4"
              />
            </label>

            <label className="panel-subtle flex items-center justify-between">
              <span className="text-sm font-medium">Camera preview</span>
              <input
                type="checkbox"
                checked={cameraEnabled}
                onChange={(e) => setCameraEnabled(e.target.checked)}
                className="h-4 w-4"
              />
            </label>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
            <div className="space-y-4">
              <div className="panel-subtle">
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

              <div className="panel-subtle">
                <div className="mb-2 flex items-center justify-between">
                  <span className="field-label mb-0">Mic confidence</span>
                  <span className="text-xs text-muted">{micEnabled ? `${micLevel}%` : "Off"}</span>
                </div>
                <div className="progress-track h-2 overflow-hidden rounded-full">
                  <div
                    className="progress-active-bar h-full rounded-full transition-all duration-150"
                    style={{ width: `${micEnabled ? micLevel : 0}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted">Speak before recording to verify microphone activity.</p>
              </div>

              <div className="action-group pt-1">
                {state !== "recording" ? (
                  <button
                    type="button"
                    onClick={() => void startRecording()}
                    className="btn-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={state === "requesting_permissions" || !!unsupportedReason}
                  >
                    {state === "requesting_permissions" ? "Requesting permissions..." : "Start capture"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="btn-tertiary px-4 py-2"
                  >
                    Stop capture
                  </button>
                )}

                <button
                  type="button"
                  onClick={resetAll}
                  className="btn-secondary px-4 py-2"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="panel-subtle">
                <p className="field-label">Session</p>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">State</span>
                    <span className="font-medium">{stateLabelMap[state]}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">Timer</span>
                    <span className="font-medium">{formatDuration(secondsElapsed)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">Mic</span>
                    <span className="font-medium">{micEnabled ? "On" : "Off"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">Camera</span>
                    <span className="font-medium">{cameraEnabled ? "On" : "Off"}</span>
                  </div>
                </div>
              </div>

              {cameraEnabled ? (
                <div>
                  <p className="field-label">Camera preview</p>
                  <video ref={cameraPreviewRef} autoPlay muted playsInline className="video-frame max-h-48 rounded-lg" />
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="workspace-card animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150 fill-mode-both">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="workspace-label">Preview and upload</p>
              <h2 className="text-xl font-semibold tracking-tight">Review before processing</h2>
            </div>
            {sourceLabel ? <span className="status-chip">{sourceLabel}</span> : null}
          </div>

          <div className="panel-subtle p-3">
            <label htmlFor="existingVideo" className="field-label">
              Use an existing local file
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
            <div className="panel-subtle mt-4 border-dashed">
              <p className="text-sm font-medium">No preview yet</p>
              <p className="mt-1 text-sm text-hint">Stop a recording or select a local video file to continue.</p>
            </div>
          ) : (
            <>
              <video controls src={previewUrl} className="video-frame mt-4 w-full rounded-lg" />
              <div className="mt-4 action-group">
                {sourceLabel === "Screen recording" && state === "preview" ? (
                  <span className="text-sm text-muted">Auto-uploading...</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void uploadAndProcess()}
                    className="btn-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={state === "uploading" || state === "processing"}
                  >
                    {state === "uploading" ? "Uploading..." : state === "processing" ? "Queued for processing..." : "Upload and process"}
                  </button>
                )}
                {retryAvailable ? (
                  <button
                    type="button"
                    onClick={() => void uploadAndProcess()}
                    className="btn-primary px-4 py-2"
                  >
                    Retry upload
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={downloadRecording}
                  className="btn-secondary px-4 py-2"
                >
                  Save local copy
                </button>
              </div>
            </>
          )}

          {uploadProgress ? (
            <div className="panel-subtle mt-4 p-3 animate-in fade-in zoom-in-95 duration-300">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Upload progress</p>
                <p className="text-sm font-semibold">{uploadProgress.progressPct}%</p>
              </div>
              <div className="progress-track mb-2 h-2 w-full rounded-full">
                <div
                  className="progress-active-bar h-full rounded-full transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, uploadProgress.progressPct))}%` }}
                />
              </div>
              <p className="text-sm">
                {formatBytes(uploadProgress.loadedBytes)} / {formatBytes(uploadProgress.totalBytes)}
              </p>
              <p className="text-xs text-muted">
                Speed: {formatBytes(uploadProgress.speedBytesPerSec)}/s · ETA: {formatEta(uploadProgress.etaSeconds)}
              </p>
            </div>
          ) : null}

          {(videoId || jobId) ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {videoId ? (
                <div className="panel-subtle">
                  <p className="field-label">Video ID</p>
                  <p className="font-mono text-xs break-all">{videoId}</p>
                </div>
              ) : null}
              {jobId ? (
                <div className="panel-subtle">
                  <p className="field-label">Job ID</p>
                  <p className="font-mono text-xs break-all">{jobId}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
