cmake_minimum_required(VERSION 3.20)
project(sandbox_run LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find nlohmann_json if installed system-wide, otherwise use header-only
find_package(nlohmann_json REQUIRED)

# Main executable
add_executable(sandbox_run src/main.cpp src/sandbox.h)

target_link_libraries(sandbox_run PRIVATE nlohmann_json::nlohmann_json)

set_target_properties(sandbox_run PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/../toolchain/bin
)
