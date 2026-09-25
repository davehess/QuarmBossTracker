// Off-client check of Zeal's tag_shapes: builds each mesh, decodes the triangle strip the way
// Direct3D does (triangle i = indices i, i+1, i+2; repeated indices are degenerate and skipped),
// validates it, and prints JSON for preview.py to rasterise.
#include <cmath>
#include <string>
#include <vector>
#include <cstdio>

#include "tag_shapes.h"

int main() {
  std::vector<std::string> names = {"Skull", "Cross", "Sword", "Diamond", "Flame", "Star",
                                    "Wolf",  "Moon",  "Lasso", "Lute",    "Shield"};
  for (int n = 1; n <= 12; ++n) names.push_back("#" + std::to_string(n));
  for (const char *c = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"; *c; ++c) names.push_back(std::string("P") + *c);
  if (names.size() != static_cast<size_t>(TagShapes::Kind::Count)) {
    std::fprintf(stderr, "names out of step with TagShapes::Kind\n");
    return 1;
  }
  int failures = 0;
  std::printf("[\n");
  for (int k = 0; k < static_cast<int>(TagShapes::Kind::Count); ++k) {
    auto mesh = TagShapes::Build(static_cast<TagShapes::Kind>(k));
    const int n = static_cast<int>(mesh.vertices.size());
    int drawn = 0, degenerate = 0, zero_area = 0;
    for (auto idx : mesh.indices)
      if (idx < 0 || idx >= n) {
        std::fprintf(stderr, "%s: index %d out of range (%d vertices)\n", names[k].c_str(), idx, n);
        ++failures;
      }
    std::printf("{\"name\":\"%s\",\"min_z\":%.4f,\"max_z\":%.4f,\"vertices\":[", names[k].c_str(), mesh.min_z, mesh.max_z);
    for (int i = 0; i < n; ++i) {
      const auto &v = mesh.vertices[i];
      std::printf("%s[%.4f,%.4f,%.4f,%d]", i ? "," : "", v.x, v.y, v.z, static_cast<int>(v.tone));
    }
    std::printf("],\"triangles\":[");
    const int prims = static_cast<int>(mesh.indices.size()) - 2;
    bool first = true;
    for (int i = 0; i < prims; ++i) {
      int a = mesh.indices[i], b = mesh.indices[i + 1], c = mesh.indices[i + 2];
      if (a == b || b == c || a == c) {
        ++degenerate;
        continue;
      }
      const auto &A = mesh.vertices[a], &B = mesh.vertices[b], &C = mesh.vertices[c];
      // Cross product length: a non-degenerate index triple can still be zero-area (a stray join).
      float ux = B.x - A.x, uy = B.y - A.y, uz = B.z - A.z, vx = C.x - A.x, vy = C.y - A.y, vz = C.z - A.z;
      float cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (std::sqrt(cx * cx + cy * cy + cz * cz) < 1e-6f) ++zero_area;
      std::printf("%s[%d,%d,%d]", first ? "" : ",", a, b, c);
      first = false;
      ++drawn;
    }
    std::printf("],\"primitives\":%d,\"drawn\":%d,\"degenerate\":%d,\"zero_area\":%d}%s\n", prims, drawn, degenerate,
                zero_area, k + 1 < static_cast<int>(TagShapes::Kind::Count) ? "," : "");
    std::fprintf(stderr, "%-8s vertices %4d  indices %4zu  primitives %4d  drawn %4d  degenerate %4d  zero-area %d  z %.2f..%.2f\n",
                 names[k].c_str(), n, mesh.indices.size(), prims, drawn, degenerate, zero_area, mesh.min_z, mesh.max_z);
  }
  std::printf("]\n");
  return failures ? 1 : 0;
}
