// Host test of the tag-picture logic: the /tag key parser and tagicons folder scan (Zeal/nameplate.cpp) and
// the PNG/TGA header check (Zeal/tag_arrows.cpp), extracted verbatim into extracted.inc by pictures.sh.
#include <algorithm>
#include <array>
#include <cassert>
#include <cctype>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <map>
#include <string>
#include <vector>

#include "tag_shapes.h"
typedef unsigned long DWORD;
typedef DWORD D3DCOLOR;
#define D3DCOLOR_XRGB(r, g, b) ((D3DCOLOR)((0xffu << 24) | (((r)&0xff) << 16) | (((g)&0xff) << 8) | ((b)&0xff)))

struct UISkin {  // Stand-in: the folder under test.
  static inline std::filesystem::path root;
  static std::filesystem::path get_zeal_resources_path() { return root; }
};

#include "extracted.inc"

namespace fs = std::filesystem;

static void Write(const fs::path &path, std::vector<unsigned char> bytes) {
  std::ofstream(path, std::ios::binary).write(reinterpret_cast<const char *>(bytes.data()), bytes.size());
}

static std::vector<unsigned char> Png(unsigned int w, unsigned int h) {
  std::vector<unsigned char> b = {0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 13, 'I', 'H', 'D', 'R'};
  for (unsigned int v : {w, h})
    for (int shift : {24, 16, 8, 0}) b.push_back((v >> shift) & 0xff);
  b.resize(40, 0);
  return b;
}

static std::vector<unsigned char> Tga(unsigned char type, unsigned int w, unsigned int h) {
  std::vector<unsigned char> b(40, 0);
  b[2] = type;
  b[12] = w & 0xff, b[13] = w >> 8, b[14] = h & 0xff, b[15] = h >> 8, b[16] = 32;
  return b;
}

static bool Size(const fs::path &path, unsigned int &w, unsigned int &h) {
  w = h = 0;
  return ReadImageSize(path.string(), w, h);
}

int main() {
  const fs::path root = fs::temp_directory_path() / "zeal-tagicons-test";
  fs::remove_all(root);
  const fs::path folder = root / "tagicons";
  fs::create_directories(folder / "dir.png");  // A directory with a picture's name is skipped.

  // Header check: PNG and true-color TGA give their size; anything else is refused before decoding.
  unsigned int w, h;
  Write(root / "a.png", Png(64, 48));
  assert(Size(root / "a.png", w, h) && w == 64 && h == 48);
  Write(root / "big.png", Png(4096, 70000));
  assert(Size(root / "big.png", w, h) && w == 4096 && h == 70000);  // Read correctly, so the cap can refuse it.
  Write(root / "huge.png", Png(0x80000000u, 1));
  assert(Size(root / "huge.png", w, h) && w == 0x80000000u);  // The top byte doesn't overflow.
  Write(root / "a.tga", Tga(2, 300, 200));
  assert(Size(root / "a.tga", w, h) && w == 300 && h == 200);
  Write(root / "rle.tga", Tga(10, 512, 511));
  assert(Size(root / "rle.tga", w, h) && w == 512 && h == 511);
  Write(root / "mapped.tga", Tga(1, 64, 64));
  assert(!Size(root / "mapped.tga", w, h));
  Write(root / "grey.tga", Tga(3, 64, 64));
  assert(!Size(root / "grey.tga", w, h));
  Write(root / "photo.jpg", {0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'J', 'F', 'I', 'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0});
  assert(!Size(root / "photo.jpg", w, h));
  Write(root / "short.png", {0x89, 'P', 'N', 'G'});
  assert(!Size(root / "short.png", w, h));
  assert(!Size(root / "missing.png", w, h));

  // The folder: <code>.png or .tga, 1 to 6 letters or digits, any case; everything else is skipped.
  UISkin::root = root;
  Write(folder / "EUR.png", Png(128, 128));
  Write(folder / "pic1.TGA", Tga(2, 64, 64));  // Not a guild code.
  Write(folder / "ZEK.tga", Tga(2, 64, 64));
  Write(folder / "Toolong7.png", Png(64, 64));
  Write(folder / "bad-1.png", Png(64, 64));
  Write(folder / "notes.txt", {'h', 'i'});
  const auto &images = GetTagImages();
  assert(images.shipped.size() == 3 && images.shipped.count("eur") && images.shipped.count("pic1") &&
         images.shipped.count("zek") && images.custom.empty());

  assert(GetTagImage("IEUR") && GetTagImage("ieur") && GetTagImage("iPiC1"));
  assert(GetTagImage("IEUR")->filename() == "EUR.png");
  assert(!GetTagImage("IXYZ") && !GetTagImage("BEUR") && !GetTagImage("I") && !GetTagImage("IEU"));
  assert(!GetTagImage("Itoolong7") && !GetTagImage("Ibad-1") && !GetTagImage("Inotes") && !GetTagImage("Idir"));

  // Keys: a picture's code is read to the next '^', like a guild's; an unknown code is still one letter.
  assert(ReadTagKey("^IEUR^Loot") == "IEUR" && ReadTagKey("^ipic1^") == "ipic1" && ReadTagKey("^IZEK^") == "IZEK");
  assert(ReadTagKey("^IXYZ^Kill") == "I" && ReadTagKey("^IMAY^") == "IMAY" && ReadTagKey("^BEUR^") == "BEUR");
  assert(ReadTagKey("^IPIC1") == "I" && ReadTagKey("^R^x") == "R" && ReadTagKey("^WP^") == "WP");
  // A picture with no built-in guild icon has no color of its own (the caller falls back to a white arrow);
  // one with a guild code keeps that guild's icon color as its fallback.
  assert(GetTagArrowColor("IPIC1") == TagArrowColor::Off);
  assert(GetTagArrowColor("IEUR") == TagArrowColor::Euro);

  // /tag icons reads the folder again.
  Write(folder / "MAY.png", Png(64, 64));
  assert(!GetTagImage("IMAY") && GetTagImages(true).shipped.size() == 4 && GetTagImage("IMAY"));

  // The whole key also names an icon's picture: Windows allows no file called CON.png, so ICON.png is the
  // only way to picture ^ICON^. In one folder the code's own name still comes first.
  Write(folder / "ICON.png", Png(64, 64));
  Write(folder / "IEUR.png", Png(64, 64));
  GetTagImages(true);
  assert(GetTagImage("ICON") && GetTagImage("ICON")->filename() == "ICON.png");
  assert(GetTagImage("IEUR")->filename() == "EUR.png");

  // A banner's picture is named for the whole key, and only a real guild's banner counts.
  Write(folder / "BEUR.png", Png(64, 64));
  Write(folder / "BXYZ.png", Png(64, 64));
  GetTagImages(true);
  assert(GetTagImage("BEUR") && GetTagImage("BEUR")->filename() == "BEUR.png" && !GetTagImage("BXYZ"));
  assert(ReadTagKey("^BEUR^") == "BEUR" && ReadTagKey("^BXYZ^") == "B");

  // A player's own folder, tagicons/custom: it wins over a shipped picture under either name, and a
  // picture only there is found too.
  fs::create_directories(folder / "custom");
  Write(folder / "custom" / "IEUR.png", Png(32, 32));  // Whole-key name, over the shipped EUR.png.
  Write(folder / "custom" / "zek.png", Png(32, 32));   // Same name in another case, over ZEK.tga.
  Write(folder / "custom" / "NEW1.tga", Tga(2, 32, 32));
  Write(folder / "custom" / "BEUR.png", Png(32, 32));
  const auto &both = GetTagImages(true);
  assert(both.custom.size() == 4);
  assert(GetTagImage("IEUR")->parent_path().filename() == "custom");
  assert(GetTagImage("IZEK")->parent_path().filename() == "custom");
  assert(GetTagImage("BEUR")->parent_path().filename() == "custom");
  assert(GetTagImage("INEW1") && GetTagImage("INEW1")->parent_path().filename() == "custom");
  assert(GetTagImage("IPIC1")->parent_path().filename() == "tagicons");  // Not replaced: still shipped.
  assert(!both.shipped.count("custom"));                                   // The folder is not a picture.

  // No folder at all: no pictures, no error.
  UISkin::root = root / "nowhere";
  assert(GetTagImages(true).shipped.empty() && GetTagImages().custom.empty() && !GetTagImage("IEUR") &&
         ReadTagKey("^IEUR^") == "IEUR");

  fs::remove_all(root);
  std::puts("tag pictures: all checks passed");
  return 0;
}
