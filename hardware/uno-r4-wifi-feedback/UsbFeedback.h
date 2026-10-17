#ifndef MOTIONTRIAL_USB_FEEDBACK_H
#define MOTIONTRIAL_USB_FEEDBACK_H
#include "FeedbackProtocol.h"

namespace MotionTrial {
// USB-only, bounded LF framing. No credentials, networking or blocking reads.
// A HELLO is deliberately idle; only a current-session SET renews the lease.
class UsbFeedback {
 public:
  static const size_t MAX_FRAME_BYTES = 96;
  FeedbackLease feedback;
  char session[17];
  uint32_t lastSequence;
  UsbFeedback() : lastSequence(0), size(0), startedAtMs(0), building(false), dropping(false) {
    session[0] = 0;
  }
  void tick(uint32_t now) {
    feedback.tick(now);
    if (building && uint32_t(now - startedAtMs) >= REQUEST_MS) {
      size = 0; building = false; dropping = true;
    }
  }
  // True only when a complete valid frame should receive an acknowledgement.
  bool feed(uint8_t byte, uint32_t now) {
    tick(now);
    if (byte == '\n') {
      const bool valid = !dropping && size > 0;
      line[size] = 0;
      size = 0; building = false; dropping = false;
      return valid && processLine(now);
    }
    if (dropping) return false;
    if (!building) { building = true; startedAtMs = now; }
    if (byte < 32 || byte > 126 || size >= sizeof(line) - 1) {
      size = 0; building = false; dropping = true;
      return false;
    }
    line[size++] = (char)byte;
    return false;
  }

 private:
  char line[MAX_FRAME_BYTES];
  size_t size;
  uint32_t startedAtMs;
  bool building, dropping;
  static bool validSession(const char* value) {
    if (strlen(value) != 16) return false;
    for (size_t i = 0; i < 16; ++i)
      if (!((value[i] >= '0' && value[i] <= '9') || (value[i] >= 'a' && value[i] <= 'f'))) return false;
    return true;
  }
  static bool sequence(const char* value, uint32_t& result) {
    if (!*value) return false;
    result = 0;
    for (const char* p = value; *p; ++p) {
      if (*p < '0' || *p > '9') return false;
      const uint32_t digit = uint32_t(*p - '0');
      if (result > (UINT32_MAX - digit) / 10) return false;
      result = result * 10 + digit;
    }
    return result > 0;
  }
  bool processLine(uint32_t now) {
    char* tokens[5];
    size_t count = 1;
    tokens[0] = line;
    for (char* p = line; *p; ++p) {
      if (*p == ' ') {
        if (p == line || p[-1] == 0 || !p[1] || count == 5) return false;
        *p = 0; tokens[count++] = p + 1;
      }
    }
    if (count == 2 && !strcmp(tokens[0], "HELLO") && validSession(tokens[1])) {
      feedback.idle(); memcpy(session, tokens[1], sizeof(session)); lastSequence = 0;
      return true;
    }
    if (!session[0] || count < 3 || strcmp(tokens[1], session)) return false;
    uint32_t nextSequence;
    if (!sequence(tokens[2], nextSequence) || nextSequence <= lastSequence) return false;
    if (count == 3 && !strcmp(tokens[0], "STATUS")) {
      lastSequence = nextSequence; // Ordering only: never refresh feedback.
      return true;
    }
    if (count != 4 || strcmp(tokens[0], "SET")) return false;
    State next;
    if (!strcmp(tokens[3], "idle")) next = IDLE;
    else if (!strcmp(tokens[3], "good")) next = GOOD;
    else if (!strcmp(tokens[3], "off")) next = OFF;
    else return false;
    lastSequence = nextSequence;
    feedback.accept(next, now);
    return true;
  }
};
} // namespace MotionTrial
#endif
