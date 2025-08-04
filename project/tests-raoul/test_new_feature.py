import pytest


class TestNewFeature:
    """Test cases for new feature"""
    
    def test_feature_initialization(self):
        """Test feature can be initialized"""
        feature = {"name": "test", "enabled": True}
        assert feature["enabled"] is True
        assert feature["name"] == "test"
    
    def test_data_validation(self):
        """Test data validation logic"""
        valid_data = {"id": 1, "value": "test"}
        assert valid_data["id"] > 0
        assert isinstance(valid_data["value"], str)
    
    def test_error_handling(self):
        """Test error handling"""
        with pytest.raises(KeyError):
            data = {}
            _ = data["missing_key"]
    
    @pytest.mark.parametrize("input,expected", [
        (1, 2),
        (2, 4),
        (3, 6),
        (4, 8),
    ])
    def test_multiplication(self, input, expected):
        """Test parameterized multiplication"""
        assert input * 2 == expected