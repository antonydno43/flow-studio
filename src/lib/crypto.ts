import crypto from "crypto";

/**
 * Credential Vault - AES-256-GCM encryption for customer integration
 * credentials. The key comes from CREDENTIAL_ENCRYPTION_KEY (32-byte hex).
 * Secrets are only ever decrypted inside server-side connector execution.
 */

const KEY = process.env.CREDENTIAL_ENCRYPTION_KEY || "";

export interface EncryptedPayload {
  v: number;
  iv: string;
  tag: string;
  data: string;
}

function getKey(): Buffer {
  if (!KEY || KEY.length < 64) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY is not configured (expected 32-byte hex string)"
    );
  }
  return Buffer.from(KEY, "hex");
}

export function isVaultConfigured(): boolean {
  return !!(KEY && KEY.length >= 64);
}

export function encryptSecrets(plain: Record<string, unknown>): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const json = JSON.stringify(plain);
  const data = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload: EncryptedPayload = {
    v: 1,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: data.toString("hex"),
  };
  return JSON.stringify(payload);
}

export function decryptSecrets(encrypted: string): Record<string, unknown> {
  const payload = JSON.parse(encrypted) as EncryptedPayload;
  if (payload.v !== 1) throw new Error("Unsupported credential version");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(payload.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "hex"));
  const data = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "hex")),
    decipher.final(),
  ]);
  return JSON.parse(data.toString("utf8"));
}

/** Redact secrets for logging: never log full tokens. */
export function redact(value: string, keep = 4): string {
  if (!value) return "";
  if (value.length <= keep * 2) return "***";
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
}

export function generateSigningSecret(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function generatePublicId(prefix = ""): string {
  const raw = crypto.randomBytes(9).toString("base64url");
  return prefix ? `${prefix}_${raw}` : raw;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
