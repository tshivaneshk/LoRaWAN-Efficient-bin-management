"""AES-128-CCM implementation using the cryptography package.

Note:
This format is custom for this bridge/backend pipeline and is NOT LoRaWAN-compatible.
Packet format: nonce (13 bytes) || ciphertext || tag (8 bytes).
Tag length: 8 bytes.
Key size: 16 bytes (128 bits).
Nonce size: 13 bytes.
"""
from __future__ import annotations

import os
from cryptography.hazmat.primitives.ciphers.aead import AESCCM


TAG_LENGTH = 8
NONCE_LENGTH = 13
KEY_LENGTH = 16


class AuthenticationError(Exception):
    """Raised when ciphertext authentication or MAC verification fails."""
    pass


class MalformedPacketError(Exception):
    """Raised when the packet structure or length is invalid."""
    pass


def generate_key() -> bytes:
    """Generate a random 128-bit (16-byte) AES key."""
    return AESCCM.generate_key(bit_length=128)


def generate_nonce() -> bytes:
    """Generate a random 13-byte nonce."""
    return os.urandom(NONCE_LENGTH)


def nonce_from_counter(device_id: bytes, counter: int) -> bytes:
    """Construct a deterministic 13-byte nonce from device_id and monotonic counter.

    Args:
        device_id: Exactly 5 bytes identifier.
        counter: Non-negative integer formatted as 8-byte big-endian.
    Returns:
        13-byte nonce (5 bytes device_id + 8 bytes counter).
    """
    if not isinstance(device_id, (bytes, bytearray)) or len(device_id) != 5:
        raise ValueError("device_id must be exactly 5 bytes")
    if not isinstance(counter, int) or counter < 0:
        raise ValueError("counter must be a non-negative integer")
    if counter >= (1 << 64):
        raise ValueError("counter overflow (exceeds 64 bits)")
    return bytes(device_id) + counter.to_bytes(8, byteorder="big")


def encrypt_with_nonce(key: bytes, nonce: bytes, plaintext: bytes, associated_data: bytes | None = None) -> bytes:
    """Encrypt plaintext with AES-128-CCM using an explicit nonce.

    Returns:
        nonce (13 bytes) || ciphertext || tag (8 bytes)
    """
    if not isinstance(key, (bytes, bytearray)) or len(key) != KEY_LENGTH:
        raise ValueError(f"key must be exactly {KEY_LENGTH} bytes")
    if not isinstance(nonce, (bytes, bytearray)) or len(nonce) != NONCE_LENGTH:
        raise ValueError(f"nonce must be exactly {NONCE_LENGTH} bytes")
    if not isinstance(plaintext, (bytes, bytearray)):
        raise ValueError("plaintext must be bytes")

    aesccm = AESCCM(bytes(key), tag_length=TAG_LENGTH)
    # cryptography AESCCM.encrypt appends the tag to the ciphertext
    ct_and_tag = aesccm.encrypt(bytes(nonce), bytes(plaintext), bytes(associated_data) if associated_data else None)
    return bytes(nonce) + ct_and_tag


def encrypt(key: bytes, plaintext: bytes, associated_data: bytes | None = None) -> bytes:
    """Encrypt plaintext with AES-128-CCM generating a fresh random nonce.

    Returns:
        nonce (13 bytes) || ciphertext || tag (8 bytes)
    """
    nonce = generate_nonce()
    return encrypt_with_nonce(key, nonce, plaintext, associated_data)


def decrypt(key: bytes, packet: bytes, associated_data: bytes | None = None) -> bytes:
    """Decrypt and verify packet: nonce(13) || ciphertext || tag(8).

    Args:
        key: 16-byte key.
        packet: Combined byte packet.
        associated_data: Optional AAD bytes.

    Returns:
        Decrypted plaintext bytes.

    Raises:
        MalformedPacketError: If packet is shorter than 21 bytes (13 nonce + 8 tag).
        AuthenticationError: If tag authentication fails.
    """
    if not isinstance(key, (bytes, bytearray)) or len(key) != KEY_LENGTH:
        raise ValueError(f"key must be exactly {KEY_LENGTH} bytes")
    if not isinstance(packet, (bytes, bytearray)):
        raise MalformedPacketError("packet must be bytes")
    if len(packet) < NONCE_LENGTH + TAG_LENGTH:
        raise MalformedPacketError("packet too short for nonce and authentication tag")

    nonce = packet[:NONCE_LENGTH]
    ct_and_tag = packet[NONCE_LENGTH:]

    aesccm = AESCCM(bytes(key), tag_length=TAG_LENGTH)
    try:
        plaintext = aesccm.decrypt(nonce, ct_and_tag, bytes(associated_data) if associated_data else None)
        return plaintext
    except Exception as exc:
        raise AuthenticationError("decryption authentication failed") from exc
