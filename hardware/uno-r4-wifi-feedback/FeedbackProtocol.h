#ifndef MOTIONTRIAL_FEEDBACK_PROTOCOL_H
#define MOTIONTRIAL_FEEDBACK_PROTOCOL_H

// Dependency-free protocol and lease logic. The host tests exercise this exact header.
#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace MotionTrial {
static const uint32_t LEASE_MS = 900;
static const uint32_t REQUEST_MS = 350;
static const size_t MAX_HEADER_BYTES = 1536;
static const size_t MAX_LINE_BYTES = 256;

enum State { IDLE, GOOD, OFF };
struct OutputPattern { bool green, red, beep; };
inline OutputPattern outputPattern(State state, uint32_t elapsedInStateMs) {
  const uint32_t lightPhase = elapsedInStateMs % 600;
  const uint32_t beepPhase = elapsedInStateMs % 200;
  const OutputPattern result = { state == GOOD, state == OFF && lightPhase < 300,
    state == OFF && beepPhase < 80 };
  return result;
}
inline const char* stateName(State state) {
  return state == GOOD ? "good" : state == OFF ? "off" : "idle";
}
inline bool isHexKey(const char* key) {
  const size_t length = strlen(key);
  if (length < 32 || length > 64) return false;
  for (size_t i = 0; i < length; ++i) {
    const char c = key[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false;
  }
  return true;
}
inline bool equalKey(const char* value, const char* expected) {
  const size_t n = strlen(expected);
  if (strlen(value) != n) return false;
  uint8_t difference = 0;
  for (size_t i = 0; i < n; ++i) difference |= (uint8_t)(value[i] ^ expected[i]);
  return difference == 0;
}
inline char lower(char c) { return c >= 'A' && c <= 'Z' ? char(c + ('a' - 'A')) : c; }
inline bool equalIgnoreCase(const char* a, const char* b) {
  while (*a && *b) if (lower(*a++) != lower(*b++)) return false;
  return *a == *b;
}

class FeedbackLease {
 public:
  State state;
  uint32_t lastPostMs;
  bool hasLease;
  FeedbackLease() : state(IDLE), lastPostMs(0), hasLease(false) {}
  void idle() { state = IDLE; hasLease = false; }
  void accept(State next, uint32_t now) { state = next; lastPostMs = now; hasLease = true; }
  void tick(uint32_t now) {
    if (hasLease && uint32_t(now - lastPostMs) >= LEASE_MS) idle();
  }
};

class RequestParser {
 public:
  bool done;
  bool post;
  int status;
  State requestedState;
  explicit RequestParser(const char* sharedKey) : key(sharedKey) { reset(); }
  void reset() {
    done = false; post = false; status = 0; requestedState = IDLE;
    lineSize = 0; headerBytes = 0; bodySize = 0; contentLength = 0;
    requestLine = true; headersDone = false; sawCr = false;
    hasKey = false; keyValid = false; hasLength = false; hasType = false;
  }
  void fail(int code) { if (!done) { status = code; done = true; } }
  void feed(uint8_t byte) {
    if (done) return;
    if (headersDone) {
      if (bodySize >= sizeof(body) - 1 || bodySize >= contentLength) { fail(400); return; }
      body[bodySize++] = char(byte);
      if (bodySize == contentLength) finishBody();
      return;
    }
    if (++headerBytes > MAX_HEADER_BYTES) { fail(431); return; }
    if (sawCr) {
      sawCr = false;
      if (byte != '\n') { fail(400); return; }
      line[lineSize] = 0;
      processLine();
      lineSize = 0;
    } else if (byte == '\r') sawCr = true;
    else if (byte < 32 || byte > 126) fail(400);
    else if (lineSize >= sizeof(line) - 1) fail(431);
    else line[lineSize++] = char(byte);
  }

 private:
  const char* key;
  char line[MAX_LINE_BYTES];
  char body[8];
  size_t lineSize, headerBytes, bodySize, contentLength;
  bool requestLine, headersDone, sawCr, hasKey, keyValid, hasLength, hasType;

  void processLine() {
    if (requestLine) {
      requestLine = false;
      char* firstSpace = strchr(line, ' ');
      if (!firstSpace) { fail(400); return; }
      *firstSpace++ = 0;
      char* secondSpace = strchr(firstSpace, ' ');
      if (!secondSpace) { fail(400); return; }
      *secondSpace++ = 0;
      if (strcmp(secondSpace, "HTTP/1.1") && strcmp(secondSpace, "HTTP/1.0")) { fail(400); return; }
      if (!strcmp(line, "POST")) post = true;
      else if (strcmp(line, "GET")) { fail(405); return; }
      const char* expected = post ? "/motiontrial/feedback" : "/motiontrial/status";
      if (strcmp(firstSpace, expected)) fail(404);
      return;
    }
    if (lineSize == 0) {
      if (!hasKey || !keyValid) { fail(401); return; }
      if (post) {
        if (!hasLength || !hasType || contentLength < 4 || contentLength > 5) { fail(400); return; }
        headersDone = true;
      } else {
        if (contentLength != 0) { fail(400); return; }
        status = 200; done = true;
      }
      return;
    }
    char* colon = strchr(line, ':');
    if (!colon || colon == line) { fail(400); return; }
    *colon++ = 0;
    // Reject whitespace in header names and folded headers.
    for (char* p = line; *p; ++p) if (*p == ' ' || *p == '\t') { fail(400); return; }
    while (*colon == ' ') ++colon;
    char* end = colon + strlen(colon);
    while (end > colon && end[-1] == ' ') *--end = 0;
    if (equalIgnoreCase(line, "X-MotionTrial-Key")) {
      if (hasKey) { fail(400); return; }
      hasKey = true; keyValid = equalKey(colon, key);
    } else if (equalIgnoreCase(line, "Content-Length")) {
      if (hasLength || !*colon) { fail(400); return; }
      hasLength = true;
      for (const char* p = colon; *p; ++p) {
        if (*p < '0' || *p > '9' || contentLength > 5) { fail(400); return; }
        contentLength = contentLength * 10 + size_t(*p - '0');
      }
      if (contentLength > 5) fail(413);
    } else if (equalIgnoreCase(line, "Content-Type")) {
      if (hasType || !equalIgnoreCase(colon, "text/plain")) { fail(400); return; }
      hasType = true;
    } else if (equalIgnoreCase(line, "Transfer-Encoding") || equalIgnoreCase(line, "Expect")) {
      fail(400); // No chunked bodies, ambiguous lengths, or 100-continue waits.
    }
  }
  void finishBody() {
    body[bodySize] = 0;
    if (bodySize == 5 && !memcmp(body, "idle\n", 5)) requestedState = IDLE;
    else if (bodySize == 5 && !memcmp(body, "good\n", 5)) requestedState = GOOD;
    else if (bodySize == 4 && !memcmp(body, "off\n", 4)) requestedState = OFF;
    else { fail(400); return; }
    status = 200; done = true;
  }
};
} // namespace MotionTrial
#endif
