"""Per-second version of the prototype's Car.update().

Conversion from the original per-frame values (60 FPS):
  speeds          x 60      (px/frame   -> px/s)
  accelerations   x 60 x 60 (px/frame^2 -> px/s^2)
  turn speed      x 60      (deg/frame  -> deg/s)

These are prototype feel values, not real-world vehicle specifications.
"""

import math
from dataclasses import dataclass
from typing import Optional

from .nitrous import NitrousTank

REFERENCE_FPS = 60


@dataclass(frozen=True)
class CarConfig:
    max_speed: float = 10 * REFERENCE_FPS                # 600 px/s
    acceleration: float = 0.25 * REFERENCE_FPS ** 2      # 900 px/s^2
    friction: float = 0.05 * REFERENCE_FPS ** 2          # 180 px/s^2
    turn_rate: float = 4 * REFERENCE_FPS                 # 240 deg/s
    reverse_speed_fraction: float = 0.5
    nitro_acceleration: float = 0.5 * REFERENCE_FPS ** 2  # 1800 px/s^2
    nitro_speed_multiplier: float = 1.5
    min_turn_speed: float = 0.2 * REFERENCE_FPS          # 12 px/s
    # The original clamps to max_speed *before* adding nitro, so holding
    # throttle + nitro only ever reaches max_speed + one frame of boost
    # (10.5, not 15) and the result depends on the frame rate. False (default)
    # fixes that: while boosting, the throttle cap is the boosted cap.
    # True reproduces the original exactly at 60 FPS.
    legacy_nitro_clamp: bool = False
    world_width: float = 800
    world_height: float = 600
    world_margin: float = 20


@dataclass(frozen=True)
class DriveInput:
    throttle: bool = False
    brake: bool = False     # also reverse, as in the prototype
    left: bool = False
    right: bool = False
    nitro: bool = False


class Car:
    def __init__(self, x: float, y: float, config: CarConfig = CarConfig(),
                 nitrous: Optional[NitrousTank] = None):
        self.x = float(x)
        self.y = float(y)
        self.angle = 0.0   # degrees, counter-clockwise, 0 = +x
        self.speed = 0.0   # px/s, negative = reversing
        self.config = config
        self.nitrous = nitrous  # None = unlimited nitro, like the original

    def update(self, inp: DriveInput, dt: float) -> None:
        c = self.config
        can_boost = self.speed > 0
        if self.nitrous is None:
            boosting = inp.nitro and can_boost
        else:
            boosting = self.nitrous.update(inp.nitro, can_boost, dt)
        boost_cap = c.max_speed * c.nitro_speed_multiplier
        throttle_cap = boost_cap if (boosting and not c.legacy_nitro_clamp) else c.max_speed

        if inp.throttle:
            if self.speed <= throttle_cap:
                self.speed = min(self.speed + c.acceleration * dt, throttle_cap)
            elif c.legacy_nitro_clamp:
                self.speed = c.max_speed
            else:  # above the cap after a boost: bleed off instead of snapping
                self.speed = max(throttle_cap, self.speed - c.friction * dt)
        elif inp.brake:
            self.speed = max(self.speed - c.acceleration * dt,
                             -c.max_speed * c.reverse_speed_fraction)
        elif self.speed > 0:
            self.speed = max(0.0, self.speed - c.friction * dt)
        elif self.speed < 0:
            self.speed = min(0.0, self.speed + c.friction * dt)

        if c.legacy_nitro_clamp:  # original decides on the post-throttle speed
            boosting = boosting and self.speed > 0
        if boosting:
            self.speed = min(self.speed + c.nitro_acceleration * dt, boost_cap)

        if abs(self.speed) > c.min_turn_speed:
            direction = 1 if self.speed > 0 else -1
            if inp.left:
                self.angle += c.turn_rate * dt * direction
            if inp.right:
                self.angle -= c.turn_rate * dt * direction

        rad = math.radians(self.angle)
        self.x += math.cos(rad) * self.speed * dt
        self.y -= math.sin(rad) * self.speed * dt

        m = c.world_margin
        self.x = max(m, min(c.world_width - m, self.x))
        self.y = max(m, min(c.world_height - m, self.y))
