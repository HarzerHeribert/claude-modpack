import unittest

from tally import config


class ConfigTest(unittest.TestCase):
    def test_default_port(self):
        self.assertEqual(config.load()["server"]["port"], 8742)

    def test_threads_parse(self):
        self.assertIsInstance(config.load()["server"]["threads"], int)


if __name__ == "__main__":
    unittest.main()
