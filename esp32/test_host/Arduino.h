#pragma once
// Minimal Arduino.h shim so ds200.h can be compiled and unit-tested on the
// host (CI) with a normal C++ compiler. Only what ds200.h actually needs.
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
typedef std::string String;
