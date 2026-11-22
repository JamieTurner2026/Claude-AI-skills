"""Tests for the frame-rate-independent port.

The original Car class is loaded straight out of midnight_street_racer.py
(without running its game loop or needing pygame) and used as the reference.
"""

import ast
import math
import types
from collections import defaultdict
from pathlib import Path

import pytest

from reign_sim import Car, CarConfig, DriveInput, NitrousConfig, NitrousTank

ORIGINAL = Path(__file__).resolve().parents[1] / "midnight_street_racer.py"
KEYS = ["K_UP", "K_w", "K_DOWN", "K_s", "K_LEFT", "K_a", "K_RIGHT", "K_d", "K_SPACE"]


def load_original_car_class():
    tree = ast.parse(ORIGINAL.read_text())
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Car")
    fake_pygame = types.SimpleNamespace(**{k: k for k in KEYS})
    ns = {"pygame": fake_pygame, "math": math, "WIDTH": 800, "HEIGHT": 600}
    exec(compile(ast.Module(body=[cls], type_ignores=[]), str(ORIGINAL), "exec"), ns)
    return ns["Car"]


def original_keys(inp: DriveInput):
    keys = defaultdict(bool)
    keys["K_w"] = inp.throttle
    keys["K_s"] = inp.brake
    keys["K_a"] = inp.left
    keys["K_d"] = inp.right
    keys["K_SPACE"] = inp.nitro
    return keys


# (seconds, input) segments: launch, turn, boost, coast, reverse, reverse-turn
SCRIPT = [
    (0.5, DriveInput(throttle=True)),
    (0.4, DriveInput(throttle=True, left=True)),
    (0.3, DriveInput(throttle=True, nitro=True)),
    (0.3, DriveInput(right=True)),
    (0.5, DriveInput()),
    (1.5, DriveInput(brake=True)),
    (0.5, DriveInput(brake=True, left=True)),
]


def run_port(fps: int, config: CarConfig = CarConfig()) -> Car:
    car = Car(400, 300, config)
    for seconds, inp in SCRIPT:
        for _ in range(round(seconds * fps)):
            car.update(inp, 1.0 / fps)
    return car


def test_original_file_is_preserved():
    text = ORIGINAL.read_text()
    assert 'pygame.display.set_caption("Midnight Street Racer")' in text
    assert "self.max_speed = 10" in text and "clock.tick(60)" in text


def test_matches_original_step_for_step_at_60fps():
    OriginalCar = load_original_car_class()
    ref = OriginalCar(400, 300)
    car = Car(400, 300, CarConfig(legacy_nitro_clamp=True))
    for seconds, inp in SCRIPT:
        for _ in range(round(seconds * 60)):
            ref.update(original_keys(inp))
            car.update(inp, 1 / 60)
            assert car.x == pytest.approx(ref.x, abs=1e-6)
            assert car.y == pytest.approx(ref.y, abs=1e-6)
            assert car.angle == pytest.approx(ref.angle, abs=1e-6)
            assert car.speed / 60 == pytest.approx(ref.speed, abs=1e-6)


@pytest.mark.parametrize("fps", [30, 120, 240])
def test_frame_rate_independent(fps):
    # A huge world so the screen clamp does not hide differences.
    big = CarConfig(world_width=1e6, world_height=1e6)
    base, other = run_port(60, big), run_port(fps, big)
    assert other.speed == pytest.approx(base.speed, abs=1.0)
    assert other.angle == pytest.approx(base.angle, abs=4.0)
    travelled = math.hypot(base.x - 400, base.y - 300)
    assert math.hypot(other.x - base.x, other.y - base.y) < 0.08 * max(travelled, 200)


def test_top_speed_reverse_limit_and_coasting():
    car = Car(400, 300, CarConfig(world_width=1e6, world_height=1e6))
    for _ in range(600):
        car.update(DriveInput(throttle=True), 1 / 60)
    assert car.speed == pytest.approx(600)
    for _ in range(600):
        car.update(DriveInput(), 1 / 60)
    assert car.speed == 0
    for _ in range(600):
        car.update(DriveInput(brake=True), 1 / 60)
    assert car.speed == pytest.approx(-300)


def test_no_steering_when_stationary():
    car = Car(400, 300)
    car.update(DriveInput(left=True), 1 / 60)
    assert car.angle == 0


def test_nitro_raises_cap_only_when_moving_forward():
    car = Car(400, 300, CarConfig(world_width=1e6, world_height=1e6))
    car.update(DriveInput(nitro=True), 1 / 60)
    assert car.speed == 0
    for _ in range(600):
        car.update(DriveInput(throttle=True, nitro=True), 1 / 60)
    assert car.speed == pytest.approx(900)
    # Boost over: speed bleeds back to the normal cap, no instant snap.
    car.update(DriveInput(throttle=True), 1 / 60)
    assert 600 < car.speed < 900
    for _ in range(600):
        car.update(DriveInput(throttle=True), 1 / 60)
    assert car.speed == pytest.approx(600)


def test_original_nitro_quirk_is_reproduced_in_legacy_mode():
    # Finding from the prototype: throttle + nitro tops out at 10.5 px/frame,
    # not the intended 15, because of the clamp order.
    OriginalCar = load_original_car_class()
    ref = OriginalCar(400, 300)
    for _ in range(600):
        ref.update(original_keys(DriveInput(throttle=True, nitro=True)))
    assert ref.speed == pytest.approx(10.5)


def test_stays_inside_world():
    car = Car(400, 300)
    for _ in range(1000):
        car.update(DriveInput(throttle=True), 1 / 60)
    assert car.x == 780


def test_tank_drains_blocks_and_recharges():
    tank = NitrousTank(NitrousConfig())
    t = 0.0
    while tank.update(True, True, 0.01):
        t += 0.01
    assert t == pytest.approx(4.0, abs=0.05)       # 100 / 25 per second
    assert tank.amount == 0 and not tank.active
    assert tank.update(True, True, 0.01) is False  # empty: cannot boost

    for _ in range(100):                           # 1 s: still inside the delay
        tank.update(False, True, 0.01)
    assert tank.amount == 0
    for _ in range(200):                           # 2 more s: refilling
        tank.update(False, True, 0.01)
    assert 0 < tank.amount < tank.config.capacity
    for _ in range(2000):
        tank.update(False, True, 0.01)
    assert tank.amount == tank.config.capacity


def test_tank_needs_minimum_to_reactivate():
    tank = NitrousTank(NitrousConfig())
    tank.amount = 5.0
    assert tank.update(True, True, 0.01) is False
    tank.amount = 10.0
    assert tank.update(True, True, 0.01) is True


def test_limited_tank_limits_car_boost():
    cfg = CarConfig(world_width=1e7, world_height=1e7)
    car = Car(400, 300, cfg, NitrousTank())
    for _ in range(60 * 10):
        car.update(DriveInput(throttle=True, nitro=True), 1 / 60)
    # Tank ran dry after ~4 s; speed has bled back to the normal top speed.
    assert car.speed == pytest.approx(600)
    assert car.nitrous.amount == 0  # no refill while the button is held
