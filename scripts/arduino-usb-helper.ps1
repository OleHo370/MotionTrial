param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^COM(?:[1-9][0-9]{0,2})$')]
  [string]$Port
)

# This helper owns one verified Arduino serial port. It never enumerates or opens
# Bluetooth ports, connects to Wi-Fi, or writes diagnostics to the JSON channel.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Send-BridgeMessage($Value) {
  [Console]::Out.WriteLine(($Value | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}

# Windows PowerShell's Console.In.ReadLineAsync can block its calling thread.
# A bounded background reader lets the serial loop and parent-loss watchdog run.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Threading;
public sealed class MotionTrialInputReader {
  public readonly ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
  public volatile bool Ended;
  public volatile bool Overflow;
  public void Start() {
    var thread = new Thread(() => {
      try {
        var buffer = new System.Text.StringBuilder();
        while (true) {
          int value = Console.In.Read();
          if (value < 0) break;
          if (value == 10) {
            if (Lines.Count >= 8) { Overflow = true; break; }
            Lines.Enqueue(buffer.ToString()); buffer.Clear();
          } else if (value != 13) {
            if (buffer.Length >= 512) { Overflow = true; break; }
            buffer.Append((char)value);
          }
        }
      } catch { }
      finally { Ended = true; }
    });
    thread.IsBackground = true;
    thread.Start();
  }
}
'@

$serial = $null
try {
  $serial = New-Object System.IO.Ports.SerialPort($Port, 115200, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
  $serial.Encoding = [System.Text.Encoding]::ASCII
  $serial.Handshake = [System.IO.Ports.Handshake]::None
  $serial.DtrEnable = $true
  $serial.RtsEnable = $false
  $serial.ReadTimeout = 50
  $serial.WriteTimeout = 200
  $serial.Open()
  $reader = New-Object MotionTrialInputReader
  $reader.Start()
  Send-BridgeMessage @{ type = 'ready'; port = $Port }
  $serialBuffer = ''
  $running = $true
  while ($running) {
    if ($reader.Overflow) { throw 'Parent input exceeded its bound.' }
    $incoming = $null
    while ($reader.Lines.TryDequeue([ref]$incoming)) {
      $command = $incoming | ConvertFrom-Json
      if ($command.type -eq 'close') { $running = $false; break }
      if ($command.type -ne 'write' -or $command.line -isnot [string]) { throw 'Invalid bridge command.' }
      $line = $command.line
      if ($line.Length -gt 512 -or $line -notmatch '^(?:HELLO [a-f0-9]{16}|SET [a-f0-9]{16} [1-9][0-9]{0,9} (?:idle|good|off)|STATUS [a-f0-9]{16} [1-9][0-9]{0,9})$') {
        throw 'Invalid USB protocol command.'
      }
      # Flush an incomplete prior packet at every fresh handshake. Firmware
      # discards an expired partial line until LF; no unframed command is sent.
      if ($line.StartsWith('HELLO ')) { $serial.Write("`n") }
      $serial.Write($line + "`n")
    }
    if (-not $running -or $reader.Ended) { break }
    if (-not $serial.IsOpen) { throw 'USB port disconnected.' }
    $chunk = $serial.ReadExisting()
    if ($chunk.Length -gt 0) {
      foreach ($character in $chunk.ToCharArray()) {
        if ($character -eq "`n") {
          if ($serialBuffer.Length -gt 0) { Send-BridgeMessage @{ type = 'board'; line = $serialBuffer } }
          $serialBuffer = ''
        } elseif ($character -ne "`r") {
          if ($serialBuffer.Length -ge 512) { throw 'Board response exceeded its bound.' }
          $serialBuffer += $character
        }
      }
    }
    Start-Sleep -Milliseconds 5
  }
} catch {
  # Do not print wire contents, credentials, arbitrary exceptions or fake ACKs.
  Send-BridgeMessage @{ type = 'error'; message = 'Arduino USB serial connection failed. Close Serial Monitor and check the USB data cable.' }
  exit 1
} finally {
  if ($null -ne $serial) {
    if ($serial.IsOpen) { $serial.Close() }
    $serial.Dispose()
  }
  # On parent EOF or sudden process loss the firmware's independent 900 ms
  # lease silences the outputs. Normal shutdown sends and verifies idle in Node.
}
