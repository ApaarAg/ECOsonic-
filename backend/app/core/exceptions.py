from typing import Any, Optional


class EcoSonicException(Exception):
    """Base exception for all EcoSonic application errors."""

    def __init__(self, message: str, details: Optional[Any] = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class AudioValidationError(EcoSonicException):
    """Raised when an uploaded audio file fails validation (format, size, corrupt, empty)."""
    pass


class AudioProcessingError(EcoSonicException):
    """Raised when audio conversion, decoding, or inspection fails."""
    pass


class ResourceNotFoundError(EcoSonicException):
    """Raised when an entity is not found in the database."""
    pass


class JobExecutionError(EcoSonicException):
    """Raised when a background analysis job fails execution."""
    pass


class DatabaseError(EcoSonicException):
    """Raised when a database transaction or operation fails."""
    pass
