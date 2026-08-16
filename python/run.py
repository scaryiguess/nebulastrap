import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fflag.protocol import Protocol, utf8_stdout
from fflag.service import Service

def main() -> int:
    utf8_stdout()
    service = Service(Protocol())
    try:
        service.run()
    except KeyboardInterrupt:
        pass
    finally:
        service.shutdown()
    return 0

if __name__ == "__main__":
    sys.exit(main())
