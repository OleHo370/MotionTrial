// Run once before the local server. Secrets stay outside public/ and Git.
import {randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const directory=new URL('../hardware/uno-r4-wifi-feedback/',import.meta.url);
const configPath=new URL('../hardware/arduino-feedback.local.json',import.meta.url);
const headerPath=new URL('arduino_secrets.h',directory);
const readOptional=async path=>{try{return await readFile(path,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}};
await mkdir(directory,{recursive:true});
const configText=await readOptional(configPath),header=await readOptional(headerPath);
const configured=configText===null?null:JSON.parse(configText).key;
const headerKey=header?.match(/^#define\s+MOTIONTRIAL_SHARED_KEY\s+"([a-fA-F0-9]{32,64})"/m)?.[1]??null;
if(configured!==null&&(typeof configured!=='string'||!/^[a-fA-F0-9]{32,64}$/.test(configured)))
  throw Error('The existing private pairing configuration is invalid; it was not changed.');
if(header!==null&&!headerKey)throw Error('The existing private Arduino header has no valid pairing key; it was not changed.');
if(configured&&headerKey&&configured!==headerKey)throw Error('The two existing pairing keys differ; neither private file was changed.');
const key=configured??headerKey??randomBytes(16).toString('hex');
if(configText===null)await writeFile(configPath,JSON.stringify({key},null,2)+'\n',{flag:'wx'});
if(header===null)await writeFile(headerPath,`#ifndef MOTIONTRIAL_ARDUINO_SECRETS_H
#define MOTIONTRIAL_ARDUINO_SECRETS_H
// Edit only your Wi-Fi name/password locally. Do not share this file.
#define SECRET_SSID "YOUR_2_4_GHZ_WIFI_NAME"
// For a truly open network, use an empty string: "". Browser sign-in is unsupported.
#define SECRET_PASS "YOUR_WIFI_PASSWORD"
// Already paired with hardware/arduino-feedback.local.json. Keep this value.
#define MOTIONTRIAL_SHARED_KEY "${key}"
#endif
`,{flag:'wx'});
console.log('Private Arduino Wi-Fi header and matching local pairing configuration are ready.');
console.log('Edit SECRET_SSID and SECRET_PASS in hardware/uno-r4-wifi-feedback/arduino_secrets.h, then upload the sketch.');
