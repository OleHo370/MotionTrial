import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { INSTRUCTIONS, TASK_ID, TASK_VERSION, type Observation } from '../lib/types';

test('playable source, event seek, review history, refresh and scoped UI deletion', async ({ page, request }) => {
 const listing=await(await request.get('/api/sessions')).json();
 const fixture=listing.sessions.find((s:{demoCode:string})=>s.demoCode==='SYN-LOSS');
 expect(fixture,'Run npm run demo:seed before browser tests to create the labelled playable fixture.').toBeTruthy();
 const bytes=await(await request.get(`/api/sessions/${fixture.id}/video`)).body();
 const id=randomUUID(),now=new Date().toISOString();
 const observations:Observation[]=Array.from({length:200},(_,i)=>({tMs:i*100,status:i>=80&&i<110?'no_pose':'pose',landmarks:i>=80&&i<110?[]:[11,12,13,14,15,16].map(index=>({index,x:.5,y:.5,z:0,visibility:.9}))}));
 const response=await request.post('/api/sessions',{multipart:{metadata:JSON.stringify({id,demoCode:'E2E-REVIEW',provenance:'synthetic_demo',consentAt:now,recordedAt:now,durationMs:20000,interrupted:false,taskId:TASK_ID,taskVersion:TASK_VERSION,instructions:INSTRUCTIONS,modelVersion:'synthetic-fixture-e2e (no inference)',timing:{performanceStartMs:0,recorderStartMs:0,videoStartMs:0},demoCase:'Automated copy of synthetic animation; generated observations'}),observations:JSON.stringify(observations),video:{name:'synthetic.webm',mimeType:'video/webm',buffer:bytes}}});
 expect(response.status(),await response.text()).toBe(201);
 try {
  await page.goto(`/sessions/${id}`);await expect(page.getByRole('heading',{name:'E2E-REVIEW'})).toBeVisible();
  const video=page.getByLabel('Original recorded video');await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
  expect(await video.evaluate((v:HTMLVideoElement)=>Number.isFinite(v.duration)&&Math.abs(v.duration-20)<.5)).toBe(true);
  await video.evaluate((v:HTMLVideoElement)=>v.play());await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(.1);await video.evaluate((v:HTMLVideoElement)=>v.pause());
  await page.getByRole('button',{name:'Tracking unavailable 8.0 to 11.0 seconds',exact:true}).click();
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>Math.abs(v.currentTime-8))).toBeLessThan(.5);
  await page.getByLabel('Show estimated landmarks').check();
  await page.getByLabel('Review note').fill('Synthetic source checked. Tracking loss is unknown; preserve uncertainty.');
  await page.getByRole('button',{name:'Save review decision'}).click();await expect(page.getByRole('status')).toContainText('Review saved');
  await page.reload();await expect(page.getByText('Synthetic source checked. Tracking loss is unknown; preserve uncertainty.',{exact:true})).toBeVisible();
  await page.getByRole('radio',{name:/Accept for analysis/}).check();await page.getByLabel('Review note').fill('Second decision retained in history.');await page.getByRole('button',{name:'Save review decision'}).click();await expect(page.getByRole('status')).toContainText('Review saved');
  const saved=await (await request.get(`/api/sessions/${id}`)).json();expect(saved.reviews).toHaveLength(2);expect(saved.reviews[0].disposition).toBe('uncertain');expect(saved.reviews[1].disposition).toBe('accept');
  await page.evaluate(()=>window.scrollTo(0,0));await video.evaluate((v:HTMLVideoElement)=>{v.currentTime=8;});await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);await page.screenshot({path:'artifacts/review-desktop.png',fullPage:true});
  await page.getByRole('link',{name:'Linked recapture'}).click();await expect(page).toHaveURL(new RegExp(`parent=${id}`));await expect(page.getByText(/this creates a new session and keeps the original/)).toBeVisible();
  await page.goto(`/sessions/${id}`);await page.setViewportSize({width:390,height:844});await expect(page.getByRole('heading',{name:'Your review decision'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'artifacts/review-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Delete session & video'}).click();await page.getByRole('button',{name:'Delete permanently',exact:true}).click();await expect(page).toHaveURL('/');expect((await request.get(`/api/sessions/${id}`)).status()).toBe(404);expect((await request.get(`/api/sessions/${id}/video`)).status()).toBe(404);
 } finally { await request.delete(`/api/sessions/${id}`); }
});

test('queue honest empty, loading, failed and filtered states with keyboard access',async({page})=>{
 await page.route('**/api/sessions',async route=>{await new Promise(r=>setTimeout(r,150));await route.fulfill({json:{sessions:[]}});});
 await page.goto('/');await expect(page.getByRole('status')).toContainText('Loading');await expect(page.getByRole('heading',{name:'Your first recording starts here'})).toBeVisible();
 await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to content'})).toBeFocused();
 await page.screenshot({path:'artifacts/queue-empty-desktop.png',fullPage:true});
 await page.unroute('**/api/sessions');await page.route('**/api/sessions',route=>route.fulfill({status:500,json:{error:'Injected storage failure for E2E'}}));await page.getByRole('button',{name:'Refresh'}).click();await expect(page.getByRole('heading',{name:'Queue unavailable'})).toBeVisible();
 await page.unroute('**/api/sessions');await page.getByRole('button',{name:'Try again'}).click();await expect(page.getByRole('heading',{name:/Recording queue/})).toBeVisible();
 await page.getByRole('button',{name:'Examples',exact:true}).click();await page.getByRole('textbox',{name:'Search demo code or session ID'}).fill('NO-SUCH-DEMO');await expect(page.getByRole('heading',{name:'No matching recordings'})).toBeVisible();
 await page.getByRole('textbox',{name:'Search demo code or session ID'}).fill('');await page.getByRole('button',{name:'All recordings',exact:true}).click();await page.screenshot({path:'artifacts/queue-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'artifacts/queue-mobile.png',fullPage:true});
 await page.goto('/assess/new');await expect(page.getByRole('button',{name:'Continue to camera setup'})).toBeDisabled();await expect(page.getByText(INSTRUCTIONS,{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'artifacts/briefing-mobile.png',fullPage:true});
});
