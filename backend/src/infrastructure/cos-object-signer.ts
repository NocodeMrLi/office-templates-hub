import type { ObjectSigner } from "../domain/download-service.js";

export interface CosGetObjectUrlParams {
  Bucket: string;
  Region: string;
  Key: string;
  Sign: true;
  Expires: number;
}

export interface CosGetObjectUrlClient {
  getObjectUrl(
    params: CosGetObjectUrlParams,
    callback: (error: Error | null, data?: { Url?: string }) => void,
  ): void;
}

export interface CosObjectSignerConfig {
  bucket: string;
  region: string;
  expiresSeconds: number;
}

export class ObjectStorageSignError extends Error {
  readonly code = "DEPENDENCY_UNAVAILABLE";

  constructor() {
    super("下载凭证签发失败");
  }
}

export class CosObjectSigner implements ObjectSigner {
  constructor(
    private readonly client: CosGetObjectUrlClient,
    private readonly config: CosObjectSignerConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async sign(objectKey: string): Promise<{ url: string; expiresAt: Date }> {
    const url = await new Promise<string>((resolve, reject) => {
      this.client.getObjectUrl({
        Bucket: this.config.bucket,
        Region: this.config.region,
        Key: objectKey,
        Sign: true,
        Expires: this.config.expiresSeconds,
      }, (error, data) => {
        if (error || !data?.Url) {
          reject(new ObjectStorageSignError());
          return;
        }
        resolve(data.Url);
      });
    });

    return {
      url,
      expiresAt: new Date(this.clock().getTime() + this.config.expiresSeconds * 1000),
    };
  }
}
