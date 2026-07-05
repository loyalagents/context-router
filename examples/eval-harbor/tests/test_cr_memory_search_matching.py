import importlib.util
import unittest
from pathlib import Path


def load_search_matching_module():
    matcher_path = (
        Path(__file__).resolve().parents[1]
        / "sidecars"
        / "cr-memory"
        / "search_matching.py"
    )
    spec = importlib.util.spec_from_file_location("cr_memory_search_matching", matcher_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load {matcher_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


search_matching = load_search_matching_module()


class CrMemorySearchMatchingTests(unittest.TestCase):
    def test_separator_normalized_phrase_matches_slug(self) -> None:
        entry = {
            "slug": "travel.default_airport",
            "category": "travel",
            "description": "User's default departure airport.",
            "value": "SFO",
        }

        self.assertTrue(search_matching.preference_matches("default airport", entry))
        self.assertTrue(search_matching.preference_matches("default-airport", entry))
        self.assertTrue(search_matching.preference_matches("default_airport", entry))

    def test_separator_normalized_phrase_matches_dotted_underscore_slug(self) -> None:
        entry = {"slug": "work.project_codename"}

        self.assertTrue(search_matching.preference_matches("project codename", entry))

    def test_search_is_not_unordered_or_gapped_token_matching(self) -> None:
        entry = {
            "slug": "travel.departure_airport",
            "category": "travel",
            "description": "User's default departure airport.",
            "value": "SFO",
        }

        self.assertFalse(search_matching.preference_matches("default airport", entry))

    def test_empty_query_returns_all_but_separator_only_query_matches_none(self) -> None:
        entry = {"slug": "travel.default_airport"}

        self.assertTrue(search_matching.preference_matches(None, entry))
        self.assertTrue(search_matching.preference_matches("", entry))
        self.assertFalse(search_matching.preference_matches("---", entry))


if __name__ == "__main__":
    unittest.main()
