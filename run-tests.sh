#!/bin/bash
# Wrapper script to run tests without the mysterious "2" argument
npx jest --passWithNoTests "$@"