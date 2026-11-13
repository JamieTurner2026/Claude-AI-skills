"""Frame-rate-independent port of the Midnight Street Racer driving model.

The original prototype (../midnight_street_racer.py) is kept untouched. This
package re-expresses the same rules per second instead of per frame, so the
behaviour no longer depends on the frame rate, and adds the limited nitrous
tank planned for the Unreal version. It has no pygame dependency.
"""

from .car import Car, CarConfig, DriveInput
from .nitrous import NitrousConfig, NitrousTank

__all__ = ["Car", "CarConfig", "DriveInput", "NitrousConfig", "NitrousTank"]
