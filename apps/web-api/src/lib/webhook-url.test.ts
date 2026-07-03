import { describe, expect, it } from "vitest";
import { checkWebhookUrl, checkWebhookUrlSyntax, isPrivateIp } from "@cap/config";

describe("isPrivateIp", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:10.0.0.1",
    "::ffff:192.168.0.10"
  ])("blocks private/link-local %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows public %s",
    (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    }
  );
});

describe("checkWebhookUrlSyntax", () => {
  it("rejects non-http protocols", () => {
    expect(checkWebhookUrlSyntax("ftp://example.com/x").ok).toBe(false);
    expect(checkWebhookUrlSyntax("file:///etc/passwd").ok).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(checkWebhookUrlSyntax("not a url").ok).toBe(false);
  });

  it("rejects docker service names and internal suffixes", () => {
    for (const url of [
      "http://minio:9000/x",
      "http://postgres/x",
      "http://localhost:3000/x",
      "http://foo.internal/x",
      "http://bar.local/x",
      "http://metadata.google.internal/x"
    ]) {
      expect(checkWebhookUrlSyntax(url).ok).toBe(false);
    }
  });

  it("rejects private IP literals including the cloud metadata address", () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://10.1.2.3/hook",
      "http://172.18.0.5:9000/hook",
      "http://192.168.1.10/hook",
      "http://127.0.0.1:8080/hook",
      "http://[::1]/hook",
      "http://[fe80::1]/hook"
    ]) {
      expect(checkWebhookUrlSyntax(url).ok).toBe(false);
    }
  });

  it("accepts public https URLs", () => {
    expect(checkWebhookUrlSyntax("https://hooks.example.com/cap4").ok).toBe(true);
    expect(checkWebhookUrlSyntax("http://8.8.8.8/hook").ok).toBe(true);
  });
});

describe("checkWebhookUrl (with DNS)", () => {
  it("rejects hostnames that resolve to loopback", async () => {
    // "localhost." style tricks aside, use a hostname guaranteed to resolve to 127.0.0.1
    const result = await checkWebhookUrl("http://localhost/hook");
    expect(result.ok).toBe(false);
  });

  it("rejects hostnames that do not resolve", async () => {
    const result = await checkWebhookUrl("https://definitely-not-a-real-host-cap4-test.invalid/hook");
    expect(result.ok).toBe(false);
  });

  it("accepts public IP literals without a DNS lookup", async () => {
    const result = await checkWebhookUrl("http://8.8.8.8/hook");
    expect(result.ok).toBe(true);
  });
});
