"""Verify Auth0 API access tokens; never trust decoded-but-unverified claims."""

from dataclasses import dataclass
import os
import re

import jwt


class InvalidAccessToken(Exception):
    """The supplied credential cannot establish an identity."""


class AuthenticationUnavailable(Exception):
    """Trusted verification material is unavailable; fail closed."""


@dataclass(frozen=True)
class Auth0Config:
    domain: str
    audience: str

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", self.domain):
            raise ValueError("DOGEAR_AUTH0_DOMAIN must be a hostname without scheme or path")
        if not self.audience.strip():
            raise ValueError("DOGEAR_AUTH0_AUDIENCE must not be empty")

    @property
    def issuer(self) -> str:
        return f"https://{self.domain}/"

    @classmethod
    def from_environment(cls) -> "Auth0Config | None":
        domain = os.getenv("DOGEAR_AUTH0_DOMAIN", "")
        audience = os.getenv("DOGEAR_AUTH0_AUDIENCE", "")
        return cls(domain, audience) if domain and audience else None


class _JwksClient(jwt.PyJWKClient):
    def fetch_data(self):
        try:
            return super().fetch_data()
        except (jwt.PyJWTError, ValueError) as exc:
            # Errors while fetching/parsing trusted keys are not bad credentials.
            raise AuthenticationUnavailable from exc


class Auth0TokenVerifier:
    def __init__(self, config: Auth0Config) -> None:
        self.config = config
        self.keys = _JwksClient(
            f"{config.issuer}.well-known/jwks.json",
            timeout=3,
            lifespan=300,
            cooldown_duration=30,
        )

    def verify(self, token: str) -> str:
        try:
            header = jwt.get_unverified_header(token)
            if header.get("alg") != "RS256":
                raise InvalidAccessToken
            if not isinstance(header.get("kid"), str) or not header["kid"]:
                raise InvalidAccessToken
            key = self.keys.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=["RS256"],
                issuer=self.config.issuer,
                audience=self.config.audience,
                options={"require": ["exp", "iss", "aud", "sub"]},
            )
            subject = claims["sub"]
            if not isinstance(subject, str) or not subject.strip():
                raise InvalidAccessToken
            return subject
        except (jwt.InvalidTokenError, jwt.PyJWKClientError) as exc:
            raise InvalidAccessToken from exc
