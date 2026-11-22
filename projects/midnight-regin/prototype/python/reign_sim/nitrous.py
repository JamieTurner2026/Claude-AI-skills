"""Limited nitrous tank. Mirrors core/include/mr/Nitrous.h."""

from dataclasses import dataclass


@dataclass(frozen=True)
class NitrousConfig:
    capacity: float = 100.0
    drain_per_sec: float = 25.0        # 4 s of boost from a full tank
    recharge_per_sec: float = 8.0
    recharge_delay: float = 1.5        # seconds after boosting before refill starts
    min_to_activate: float = 10.0      # cannot re-trigger on fumes


class NitrousTank:
    def __init__(self, config: NitrousConfig = NitrousConfig()):
        self.config = config
        self.amount = config.capacity
        self.active = False
        self._since_use = config.recharge_delay

    @property
    def fraction(self) -> float:
        return self.amount / self.config.capacity if self.config.capacity > 0 else 0.0

    def update(self, want_boost: bool, can_boost: bool, dt: float) -> bool:
        """Advance by dt seconds. Returns True while boost is being delivered."""
        c = self.config
        wants = want_boost and can_boost
        if wants and not self.active:
            self.active = self.amount >= c.min_to_activate
        elif not wants:
            self.active = False

        if self.active:
            self.amount = max(0.0, self.amount - c.drain_per_sec * dt)
            self._since_use = 0.0
            if self.amount <= 0.0:
                self.active = False
                return True  # this step was still boosted
            return True

        # Refill only once the button is released, so holding it on an empty
        # tank does not make the boost stutter on and off.
        if want_boost:
            return False
        self._since_use += dt
        if self._since_use >= c.recharge_delay:
            self.amount = min(c.capacity, self.amount + c.recharge_per_sec * dt)
        return False
