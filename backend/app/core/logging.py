import logging
import sys


def setup_logging(level: str = "INFO") -> logging.Logger:
    """Configures structured console logging for the application."""
    log_format = (
        "%(asctime)s [%(levelname)s] [%(name)s:%(lineno)d] %(message)s"
    )
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format=log_format,
        handlers=[
            logging.StreamHandler(sys.stdout),
        ],
        force=True,
    )
    # Silence overly verbose external loggers
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("aiosqlite").setLevel(logging.WARNING)
    
    logger = logging.getLogger("ecosonic")
    return logger


logger = setup_logging()
