// Host test of the tag save/restore rules: the body of NamePlate::sync_saved_tags (from the sync_one lambda
// through the entity loop) and NamePlate::handle_entity_destructor, extracted verbatim from Zeal/nameplate.cpp
// by sync.sh, against stand-ins for the game. Plays out a tagged player leaving and coming back with a new
// spawn id, both of you zoning, a clear in view, and the NPC rules staying as they were.
#include <cassert>
#include <cstdio>
#include <cstring>
#include <functional>
#include <map>
#include <string>
#include <unordered_map>
#include <utility>

typedef unsigned long DWORD;

namespace Zeal {
namespace GameEnums {
enum EntityTypes { Player = 0, NPC = 1, NPCCorpse = 2, PlayerCorpse = 3 };
}
namespace GameStructures {
struct Entity {
  char Name[64];
  unsigned short SpawnId;
  unsigned char Type;
};
}  // namespace GameStructures
namespace Game {
inline const char *strip_name(const char *name) {  // Like the client's: digits dropped, cut at an apostrophe.
  static std::string out;
  out.clear();
  for (const char *c = name; *c && *c != '\''; ++c)
    if (*c < '0' || *c > '9') out += *c;
  return out.c_str();
}
inline GameStructures::Entity *get_target() { return nullptr; }
}  // namespace Game
}  // namespace Zeal

enum TagArrowColor : DWORD { Off = 0, Nameplate = 1, Red = 0xffff0000, Skull = 0xffe8e2d1 };

struct ZealService {
  void *ui = nullptr;
  static ZealService *get_instance() {
    static ZealService service;
    return &service;
  }
};

struct FakeSetting {
  bool get() const { return true; }  // Tagged nameplate colour off: no UI here.
};

static constexpr long long kSavedTagRefreshSeconds = 10 * 60;

class NamePlate {
 public:
  enum class ColorIndex : int { Tagged = 5 };
  struct NamePlateInfo {
    std::string text;
    std::string tag_text;
    DWORD color = 0;
    DWORD tag_color = 0;
  };
  struct SavedTag {
    std::string name;
    std::string tag_text;
    DWORD tag_color = 0;
    long long last_seen = 0;
    bool live_seen = false;
  };
  std::unordered_map<Zeal::GameStructures::Entity *, NamePlateInfo> nameplate_info_map;
  std::map<std::pair<int, int>, SavedTag> saved_tags;
  std::map<std::string, SavedTag> saved_player_tags;
  bool saved_tags_dirty = false;
  FakeSetting setting_tag_disable_tagged_color;
  std::function<unsigned int(int)> get_color_callback;

  void sync(long long now, int zone_id);
  void handle_entity_destructor(Zeal::GameStructures::Entity *entity);
  void zone() {  // What clean_ui() does to this state when you zone.
    nameplate_info_map.clear();
    for (auto &entry : saved_tags) entry.second.live_seen = false;
    for (auto &entry : saved_player_tags) entry.second.live_seen = false;
  }
};

void NamePlate::sync(long long now, int zone_id) {
#include "sync_body.inc"
}

#include "destructor.inc"

using Zeal::GameStructures::Entity;

static Entity Make(const char *name, unsigned short id, unsigned char type) {
  Entity e{};
  std::strncpy(e.Name, name, sizeof(e.Name) - 1);
  e.SpawnId = id;
  e.Type = type;
  return e;
}

int main() {
  NamePlate np;
  long long now = 1000;
  const int kZoneA = 81, kZoneB = 82;

  // A tagged player is saved by name.
  Entity p1 = Make("Aldenmar", 10, Zeal::GameEnums::Player);
  np.nameplate_info_map[&p1].tag_color = TagArrowColor::Skull;
  np.sync(now, kZoneA);
  assert(np.saved_player_tags.count("Aldenmar") && np.saved_player_tags["Aldenmar"].live_seen);
  assert(np.saved_tags.empty());  // Not under a spawn id.

  // They zone out; they come back with a new spawn id and no tag: it is restored.
  np.handle_entity_destructor(&p1);
  assert(!np.nameplate_info_map.count(&p1) && !np.saved_player_tags["Aldenmar"].live_seen);
  Entity p2 = Make("Aldenmar", 57, Zeal::GameEnums::Player);
  np.nameplate_info_map[&p2];
  np.sync(now += 5, kZoneA);
  assert(np.nameplate_info_map[&p2].tag_color == TagArrowColor::Skull);

  // You both zone: it follows them into the next zone, under yet another spawn id.
  np.zone();
  Entity p3 = Make("Aldenmar", 3, Zeal::GameEnums::Player);
  np.nameplate_info_map[&p3];
  np.sync(now += 5, kZoneB);
  assert(np.nameplate_info_map[&p3].tag_color == TagArrowColor::Skull);

  // Their corpse neither takes the tag nor drops it; after the rez it is back on them.
  Entity corpse = Make("Aldenmar's corpse", 90, Zeal::GameEnums::PlayerCorpse);
  np.handle_entity_destructor(&p3);
  np.nameplate_info_map[&corpse];
  np.sync(now += 5, kZoneB);
  assert(np.nameplate_info_map[&corpse].tag_color == TagArrowColor::Off && np.saved_player_tags.count("Aldenmar"));
  Entity p4 = Make("Aldenmar", 91, Zeal::GameEnums::Player);
  np.nameplate_info_map[&p4];
  np.sync(now += 5, kZoneB);
  assert(np.nameplate_info_map[&p4].tag_color == TagArrowColor::Skull);

  // Cleared while in view: the saved tag goes, and a later return does not bring it back.
  np.nameplate_info_map[&p4].tag_color = TagArrowColor::Off;
  np.sync(now += 5, kZoneB);
  assert(!np.saved_player_tags.count("Aldenmar"));
  np.handle_entity_destructor(&p4);
  Entity p5 = Make("Aldenmar", 92, Zeal::GameEnums::Player);
  np.nameplate_info_map[&p5];
  np.sync(now += 5, kZoneB);
  assert(np.nameplate_info_map[&p5].tag_color == TagArrowColor::Off);

  // Another player with a spawn id the first one used is untouched.
  Entity other = Make("Brackwyn", 57, Zeal::GameEnums::Player);
  np.nameplate_info_map[&other];
  np.sync(now += 5, kZoneB);
  assert(np.nameplate_info_map[&other].tag_color == TagArrowColor::Off);

  // NPCs keep the zone + spawn id rules: restored only on the same id and name, dropped as a corpse.
  NamePlate n;
  Entity g1 = Make("a gnoll pup", 44, Zeal::GameEnums::NPC);
  n.nameplate_info_map[&g1].tag_color = TagArrowColor::Red;
  n.sync(now, kZoneA);
  assert((n.saved_tags.count({kZoneA, 44})) && n.saved_player_tags.empty());
  n.zone();
  Entity g2 = Make("a gnoll pup", 44, Zeal::GameEnums::NPC);
  n.nameplate_info_map[&g2];
  n.sync(now + 5, kZoneA);
  assert(n.nameplate_info_map[&g2].tag_color == TagArrowColor::Red);
  n.zone();
  Entity wrong = Make("a large rat", 44, Zeal::GameEnums::NPC);  // Same spawn id, another mob.
  n.nameplate_info_map[&wrong];
  n.sync(now + 10, kZoneA);
  assert(n.nameplate_info_map[&wrong].tag_color == TagArrowColor::Off && !n.saved_tags.count({kZoneA, 44}));
  Entity g3 = Make("a gnoll pup", 45, Zeal::GameEnums::NPC);
  n.nameplate_info_map[&g3].tag_color = TagArrowColor::Red;
  n.sync(now + 15, kZoneA);
  g3.Type = Zeal::GameEnums::NPCCorpse;  // Killed.
  n.sync(now + 20, kZoneA);
  assert(!n.saved_tags.count({kZoneA, 45}));

  std::printf("tag sync: all checks passed\n");
  return 0;
}
