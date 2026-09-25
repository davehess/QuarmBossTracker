// Host test of NamePlate::load_saved_tags / write_saved_tags, compiled from the functions extracted
// verbatim out of Zeal/nameplate.cpp (extracted.inc) against a stub class with the same members.
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <map>
#include <string>
#include <utility>
#include <vector>

typedef unsigned long DWORD;

class NamePlate {
 public:
  struct SavedTag {
    std::string name;
    std::string tag_text;
    DWORD tag_color = 0;
    long long last_seen = 0;
    bool live_seen = false;
  };
  void load_saved_tags(const std::string &filename);
  void write_saved_tags();
  std::map<std::pair<int, int>, SavedTag> saved_tags;
  std::string saved_tags_filename;
  bool saved_tags_dirty = false;
};

#include "extracted.inc"

int main() {
  const std::string path = "tags_test.txt";
  const long long now = time(nullptr);
  NamePlate a;
  a.saved_tags_filename = path;
  a.saved_tags[{162, 1234}] = {"a shissar revenant", "Kill first | OT", 0xff00ff00, now, true};
  a.saved_tags[{162, 55}] = {"Emperor Ssraeshza", "", 1, now - 100, true};  // Arrow only, empty text.
  a.saved_tags[{89, 7}] = {"an old tag", "stale", 0xffff0000, now - 4 * 3600, false};  // Expired.
  a.saved_tags_dirty = true;
  a.write_saved_tags();
  assert(!a.saved_tags_dirty);
  assert(!std::filesystem::exists(path + ".tmp"));

  NamePlate b;
  b.saved_tags[{162, 1234}] = {"a shissar revenant", "newer", 0xff0000ff, now + 5, false};  // Newer in session.
  b.load_saved_tags(path);
  assert(b.saved_tags.size() == 2);  // Expired line dropped.
  assert((b.saved_tags[{162, 1234}].tag_text == "newer"));  // Session copy was newer: kept.
  const auto &arrow = b.saved_tags[{162, 55}];
  assert(arrow.name == "Emperor Ssraeshza" && arrow.tag_text.empty() && arrow.tag_color == 1 && !arrow.live_seen);

  NamePlate c;
  c.load_saved_tags(path);
  assert((c.saved_tags[{162, 1234}].tag_text == "Kill first | OT"));
  assert((c.saved_tags[{162, 1234}].tag_color == 0xff00ff00));

  // Malformed lines are skipped, not fatal.
  {
    std::ofstream bad(path, std::ios::app);
    bad << "garbage\n1\t2\n162\tx\t" << now << "\tff\tname\ttext\n";
  }
  NamePlate d;
  d.load_saved_tags(path);
  assert(d.saved_tags.size() == 2);
  NamePlate e;
  e.load_saved_tags("does_not_exist.txt");
  assert(e.saved_tags.empty());
  std::filesystem::remove(path);
  std::printf("roundtrip ok\n");
  return 0;
}
