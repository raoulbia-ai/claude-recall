import unittest

class TestExample(unittest.TestCase):
    def test_basic_assertion(self):
        """Test that basic assertions work"""
        self.assertEqual(1 + 1, 2)
        self.assertTrue(True)
        self.assertFalse(False)
    
    def test_string_operations(self):
        """Test string operations"""
        test_string = "Hello World"
        self.assertIn("Hello", test_string)
        self.assertEqual(test_string.lower(), "hello world")
        self.assertEqual(len(test_string), 11)
    
    def test_list_operations(self):
        """Test list operations"""
        test_list = [1, 2, 3, 4, 5]
        self.assertEqual(len(test_list), 5)
        self.assertIn(3, test_list)
        self.assertEqual(test_list[0], 1)
        self.assertEqual(test_list[-1], 5)

if __name__ == '__main__':
    unittest.main()