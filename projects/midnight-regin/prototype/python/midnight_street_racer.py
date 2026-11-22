import pygame
import math
import sys

pygame.init()

WIDTH, HEIGHT = 800, 600
screen = pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption("Midnight Street Racer")
clock = pygame.time.Clock()

ASPHALT = (25, 25, 30)
NEON_CYAN = (0, 255, 255)
NEON_PINK = (255, 20, 147)
WHITE = (255, 255, 255)

class Car:
    def __init__(self, x, y):
        self.x = x
        self.y = y
        self.angle = 0
        self.speed = 0
        self.max_speed = 10
        self.acceleration = 0.25
        self.friction = 0.05
        self.turn_speed = 4

    def update(self, keys):
        if keys[pygame.K_UP] or keys[pygame.K_w]:
            self.speed = min(
                self.speed + self.acceleration,
                self.max_speed
            )
        elif keys[pygame.K_DOWN] or keys[pygame.K_s]:
            self.speed = max(
                self.speed - self.acceleration,
                -self.max_speed / 2
            )
        else:
            if self.speed > 0:
                self.speed = max(
                    0, self.speed - self.friction
                )
            elif self.speed < 0:
                self.speed = min(
                    0, self.speed + self.friction
                )

        if keys[pygame.K_SPACE] and self.speed > 0:
            self.speed = min(
                self.speed + 0.5,
                self.max_speed * 1.5
            )

        if abs(self.speed) > 0.2:
            direction = 1 if self.speed > 0 else -1

            if keys[pygame.K_LEFT] or keys[pygame.K_a]:
                self.angle += self.turn_speed * direction

            if keys[pygame.K_RIGHT] or keys[pygame.K_d]:
                self.angle -= self.turn_speed * direction

        rad = math.radians(self.angle)

        self.x += math.cos(rad) * self.speed
        self.y -= math.sin(rad) * self.speed

        self.x = max(20, min(WIDTH - 20, self.x))
        self.y = max(20, min(HEIGHT - 20, self.y))

    def draw(self, surface):
        car_surf = pygame.Surface(
            (40, 20), pygame.SRCALPHA
        )

        pygame.draw.rect(
            car_surf,
            NEON_PINK,
            (0, 0, 40, 20),
            border_radius=4
        )

        pygame.draw.rect(
            car_surf,
            NEON_CYAN,
            (35, 2, 5, 5)
        )

        pygame.draw.rect(
            car_surf,
            NEON_CYAN,
            (35, 13, 5, 5)
        )

        rotated_car = pygame.transform.rotate(
            car_surf, self.angle
        )

        rect = rotated_car.get_rect(
            center=(self.x, self.y)
        )

        surface.blit(rotated_car, rect.topleft)

player = Car(WIDTH // 2, HEIGHT // 2)
font = pygame.font.SysFont(
    "Arial", 18, bold=True
)

while True:
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            pygame.quit()
            sys.exit()

    keys = pygame.key.get_pressed()
    player.update(keys)

    screen.fill(ASPHALT)

    for x in range(0, WIDTH, 100):
        pygame.draw.line(
            screen,
            (40, 40, 50),
            (x, 0),
            (x, HEIGHT),
            2
        )

    for y in range(0, HEIGHT, 100):
        pygame.draw.line(
            screen,
            (40, 40, 50),
            (0, y),
            (WIDTH, y),
            2
        )

    player.draw(screen)

    hud = font.render(
        "Controls: WASD / Arrows to Drive | SPACE for Nitro",
        True,
        WHITE
    )

    screen.blit(hud, (15, 15))

    pygame.display.flip()
    clock.tick(60)
