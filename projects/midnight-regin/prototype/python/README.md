# Python prototype

- `midnight_street_racer.py` — the original Pygame prototype, preserved as written. Do not edit it;
  it is the gameplay reference. Run with `pip install pygame && python midnight_street_racer.py`.
- `reign_sim/` — the same driving rules expressed per second instead of per frame (no pygame
  needed), plus the limited nitrous tank used by the Unreal version.
- `tests/` — `pip install pytest && pytest` from this folder. The tests load the original `Car`
  class out of the prototype file and check the port against it step for step at 60 FPS.
