#include "../FeedbackProtocol.h"
#include <stdio.h>
#include <stdlib.h>
#include <string>

using namespace MotionTrial;
static const char* KEY = "0123456789abcdef0123456789abcdef";
static unsigned assertions = 0;
static void check(bool condition, const char* message) {
  ++assertions;
  if (!condition) { fprintf(stderr, "FAIL: %s\n", message); exit(1); }
}
static std::string request(const std::string& method, const std::string& path,
  const std::string& body = "", const std::string& key = KEY,
  const std::string& extra = "", bool addLength = true) {
  return method + " " + path + " HTTP/1.1\r\nHost: 192.168.1.20\r\n" +
    (key.empty() ? "" : "X-MotionTrial-Key: " + key + "\r\n") +
    (method == "POST" ? "Content-Type: text/plain\r\n" : "") +
    (addLength ? "Content-Length: " + std::to_string(body.size()) + "\r\n" : "") +
    extra + "\r\n" + body;
}
static RequestParser parse(const std::string& input) {
  RequestParser parser(KEY);
  for (size_t i = 0; i < input.size(); ++i) parser.feed((uint8_t)input[i]);
  return parser;
}
static void apply(FeedbackLease& lease, const RequestParser& parser, uint32_t now) {
  if (parser.done && parser.status == 200 && parser.post) lease.accept(parser.requestedState, now);
}

int main() {
  check(isHexKey(KEY), "valid shared key");
  check(!isHexKey("REPLACE_WITH_RANDOM_32_OR_MORE_HEX_CHARACTERS"), "placeholder is disabled");
  check(!isHexKey("0123"), "short key disabled");
  check(!equalKey("0123456789abcdef0123456789abcdee", KEY), "wrong key rejected");
  check(equalKey(KEY, KEY), "same key accepted");
  FeedbackLease lease;
  check(lease.state == IDLE && !lease.hasLease, "boot idle");
  const char* bodies[] = {"idle\n", "good\n", "off\n"};
  const State states[] = {IDLE, GOOD, OFF};
  for (unsigned i = 0; i < 3; ++i) {
    RequestParser parser = parse(request("POST", "/motiontrial/feedback", bodies[i]));
    check(parser.done && parser.status == 200 && parser.post && parser.requestedState == states[i], "all three valid commands accepted");
    apply(lease, parser, 100 + i);
    check(lease.state == states[i] && lease.lastPostMs == 100 + i, "valid POST refreshes lease");
  }

  const std::string invalid[] = {
    request("POST", "/motiontrial/feedback", "off\n", ""),
    request("POST", "/motiontrial/feedback", "off\n", "ffffffffffffffffffffffffffffffff"),
    request("POST", "/motiontrial/feedback", "off\n", KEY, "X-MotionTrial-Key: " + std::string(KEY) + "\r\n"),
    request("PUT", "/motiontrial/feedback", "off\n"),
    request("GET", "/motiontrial/feedback"),
    request("POST", "/motiontrial/feedback?state=off", "off\n"),
    request("POST", "/motiontrial/feedback", "GOOD\n"),
    request("POST", "/motiontrial/feedback", "good"),
    request("POST", "/motiontrial/feedback", "off\r\n"),
    request("POST", "/motiontrial/feedback", "good\n", KEY, "Content-Length: 5\r\n"),
    request("POST", "/motiontrial/feedback", "good\n", KEY, "Content-Length: -5\r\n", false),
    request("POST", "/motiontrial/feedback", "good\n", KEY, "Content-Length: 999999999999999999999999\r\n", false),
    request("POST", "/motiontrial/feedback", "off\n", KEY, "Transfer-Encoding: chunked\r\n"),
    request("POST", "/motiontrial/feedback", "off\n", KEY, "Expect: 100-continue\r\n"),
    request("POST", "/motiontrial/feedback", "off\n", KEY, " Content-Type: text/plain\r\n"),
    request("POST", "/motiontrial/feedback", "off\n", KEY, "Content-Type: application/json\r\n"),
    request("POST", "/motiontrial/feedback", "off\n", KEY, "", false),
    request("GET", "/motiontrial/status", "off\n"),
    std::string("POST /motiontrial/feedback HTTP/1.1\n\n"),
    "GET /motiontrial/status HTTP/1.1\r\nX-Long: " + std::string(280, 'x') + "\r\n\r\n",
    "GET /motiontrial/status HTTP/1.1\r\n" + std::string(100, 'x') + std::string(1, '\0') + "\r\n\r\n"
  };
  for (size_t i = 0; i < sizeof(invalid) / sizeof(invalid[0]); ++i) {
    lease.accept(GOOD, 1000);
    const RequestParser parser = parse(invalid[i]);
    check(parser.done && parser.status != 200, "invalid request rejected");
    apply(lease, parser, 1600);
    check(lease.state == GOOD && lease.lastPostMs == 1000, "invalid request cannot change state or refresh lease");
    lease.tick(1900);
    check(lease.state == IDLE && !lease.hasLease, "invalid traffic cannot prolong outputs");
  }
  lease.accept(OFF, 2000);
  RequestParser status = parse(request("GET", "/motiontrial/status", "", KEY, "", false));
  check(status.done && status.status == 200 && !status.post, "authenticated status GET accepted");
  apply(lease, status, 2800);
  check(lease.lastPostMs == 2000 && lease.state == OFF, "GET never renews lease");
  lease.tick(2899); check(lease.state == OFF, "lease active below900ms");
  lease.tick(2900); check(lease.state == IDLE, "lease expires at900ms");

  const std::string complete = request("POST", "/motiontrial/feedback", "off\n");
  // Every possible partial header/body has no effect. Model the sketch's fixed deadline.
  for (size_t length = 0; length < complete.size(); ++length) {
    lease.accept(GOOD, 3000);
    RequestParser partial = parse(complete.substr(0, length));
    check(!partial.done, "partial request never succeeds early");
    apply(lease, partial, 3300); lease.tick(3900);
    check(lease.state == IDLE, "partial request cannot prevent watchdog expiry");
  }
  RequestParser huge(KEY);
  std::string headers = "GET /motiontrial/status HTTP/1.1\r\n";
  for (unsigned i = 0; i < 30; ++i) headers += "X-Filler: " + std::string(100, 'x') + "\r\n";
  for (size_t i = 0; i < headers.size(); ++i) huge.feed((uint8_t)headers[i]);
  check(huge.done && huge.status == 431, "total headers bounded");
  lease.accept(OFF, UINT32_MAX - 400);
  lease.tick(498); check(lease.state == OFF, "rollover lease still active at899ms");
  lease.tick(499); check(lease.state == IDLE, "millis rollover expires lease");
  lease.accept(GOOD, 100); lease.idle();
  check(lease.state == IDLE && !lease.hasLease, "disconnect force idle");

  const OutputPattern good = outputPattern(GOOD, 0);
  check(good.green && !good.red && !good.beep, "good green silent");
  for (unsigned t = 0; t < 1800; ++t) {
    const OutputPattern idle = outputPattern(IDLE, t);
    check(!idle.green && !idle.red && !idle.beep, "idle silent outputs off");
    const OutputPattern off = outputPattern(OFF, t);
    check(!off.green && off.red == (t % 600 < 300) && off.beep == (t % 200 < 80),
      "off keeps 600 ms red flashes and repeats finite 80 ms beeps every 200 ms");
  }
  printf("PASS: exact firmware C++ protocol, lease, and output logic (%u assertions).\n", assertions);
  return 0;
}
