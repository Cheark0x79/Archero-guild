import unittest

from observer.automation.state_machine import NavigationError, State, Workflow


class Verifier:
    def __init__(self, failing_screen: str | None = None) -> None:
        self.failing_screen = failing_screen
        self.checked: list[str] = []

    def assert_screen(self, name: str) -> bool:
        self.checked.append(name)
        return name != self.failing_screen


class StateMachineTests(unittest.TestCase):
    def test_runs_default_workflow_to_done(self) -> None:
        workflow = Workflow(Verifier())

        visited = workflow.run()

        self.assertEqual(visited[0], State.START)
        self.assertEqual(visited[-1], State.DONE)

    def test_raises_when_required_screen_is_missing(self) -> None:
        workflow = Workflow(Verifier(failing_screen="guild_home"))

        with self.assertRaises(NavigationError):
            workflow.run()


if __name__ == "__main__":
    unittest.main()

