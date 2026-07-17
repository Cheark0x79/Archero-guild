from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol


class State(StrEnum):
    START = "START"
    HOME_SCREEN = "HOME_SCREEN"
    GUILD_MENU = "GUILD_MENU"
    GUILD_RESEARCH = "GUILD_RESEARCH"
    CAPTURE_RESEARCH = "CAPTURE_RESEARCH"
    GUILD_RANKING = "GUILD_RANKING"
    CAPTURE_RANKING = "CAPTURE_RANKING"
    MEMBER_LIST = "MEMBER_LIST"
    CAPTURE_PROFILES = "CAPTURE_PROFILES"
    MONSTER_INVASION = "MONSTER_INVASION"
    CAPTURE_BOSS_RANKING = "CAPTURE_BOSS_RANKING"
    DONE = "DONE"


class ScreenVerifier(Protocol):
    def assert_screen(self, name: str) -> bool:
        pass


class NavigationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Transition:
    source: State
    target: State
    required_screen: str | None = None


DEFAULT_TRANSITIONS: tuple[Transition, ...] = (
    Transition(State.START, State.HOME_SCREEN),
    Transition(State.HOME_SCREEN, State.GUILD_MENU, "home"),
    Transition(State.GUILD_MENU, State.GUILD_RESEARCH, "guild_home"),
    Transition(State.GUILD_RESEARCH, State.CAPTURE_RESEARCH, "guild_research"),
    Transition(State.CAPTURE_RESEARCH, State.GUILD_RANKING),
    Transition(State.GUILD_RANKING, State.CAPTURE_RANKING, "guild_ranking"),
    Transition(State.CAPTURE_RANKING, State.MEMBER_LIST),
    Transition(State.MEMBER_LIST, State.CAPTURE_PROFILES, "member_list"),
    Transition(State.CAPTURE_PROFILES, State.MONSTER_INVASION),
    Transition(State.MONSTER_INVASION, State.CAPTURE_BOSS_RANKING, "monster_invasion"),
    Transition(State.CAPTURE_BOSS_RANKING, State.DONE),
)


class Workflow:
    def __init__(
        self,
        verifier: ScreenVerifier,
        transitions: tuple[Transition, ...] = DEFAULT_TRANSITIONS,
    ) -> None:
        self.verifier = verifier
        self.transitions = transitions
        self.state = State.START

    def step(self) -> State:
        transition = self._next_transition()
        if transition.required_screen and not self.verifier.assert_screen(transition.required_screen):
            raise NavigationError(
                f"expected screen {transition.required_screen!r} before {transition.target.value}"
            )
        self.state = transition.target
        return self.state

    def run(self) -> list[State]:
        visited = [self.state]
        while self.state is not State.DONE:
            visited.append(self.step())
        return visited

    def _next_transition(self) -> Transition:
        for transition in self.transitions:
            if transition.source is self.state:
                return transition
        raise NavigationError(f"no transition from {self.state.value}")


class DryRunVerifier:
    def assert_screen(self, name: str) -> bool:
        return True

