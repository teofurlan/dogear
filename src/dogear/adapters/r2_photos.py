"""Cloudflare R2 page photos through its S3-compatible API."""

import os
from dataclasses import dataclass, field
from threading import Lock
from urllib.parse import urlsplit

from botocore.exceptions import BotoCoreError, ClientError

from dogear.ports.photo_store import PhotosUnavailable


@dataclass(frozen=True)
class R2Config:
    endpoint: str
    access_key_id: str = field(repr=False)
    secret_access_key: str = field(repr=False)
    bucket: str

    @classmethod
    def from_environment(cls) -> "R2Config | None":
        values = [
            os.getenv(f"DOGEAR_R2_{name}", "").strip()
            for name in ("ENDPOINT", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "BUCKET")
        ]
        if not all(values):
            return None
        try:
            endpoint = urlsplit(values[0])
        except ValueError:
            return None
        if endpoint.scheme != "https" or not endpoint.hostname:
            return None
        return cls(*values)


class R2Photos:
    def __init__(self, config: R2Config, client=None):
        self.config = config
        self._client = client
        self._lock = Lock()

    def _s3(self):
        # boto3 is heavy to import; only photo requests and the night run need it.
        with self._lock:
            if self._client is None:
                import boto3
                from botocore.config import Config

                self._client = boto3.client(
                    "s3",
                    endpoint_url=self.config.endpoint,
                    aws_access_key_id=self.config.access_key_id,
                    aws_secret_access_key=self.config.secret_access_key,
                    region_name="auto",
                    config=Config(
                        signature_version="s3v4",
                        connect_timeout=3,
                        read_timeout=15,
                        retries={"max_attempts": 2, "mode": "standard"},
                    ),
                )
            return self._client

    def put(self, key: str, data: bytes) -> None:
        try:
            self._s3().put_object(
                Bucket=self.config.bucket, Key=key, Body=data, ContentType="image/jpeg"
            )
        except (BotoCoreError, ClientError, OSError):
            raise PhotosUnavailable() from None

    def get(self, key: str) -> bytes:
        try:
            response = self._s3().get_object(Bucket=self.config.bucket, Key=key)
            return response["Body"].read()
        except (BotoCoreError, ClientError, OSError, KeyError):
            raise PhotosUnavailable() from None

    def delete(self, key: str) -> None:
        try:
            self._s3().delete_object(Bucket=self.config.bucket, Key=key)
        except (BotoCoreError, ClientError, OSError):
            raise PhotosUnavailable() from None

    def close(self) -> None:
        with self._lock:
            if self._client is not None:
                self._client.close()
                self._client = None
