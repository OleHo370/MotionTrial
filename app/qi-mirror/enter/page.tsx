import type { Metadata } from 'next';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import playlist from '@/public/practice-media/24-playlist.json';
import InkLoading from '@/features/qi-mirror/components/InkLoading';
import '../styles/homepage-base.css';
import '../styles/landing.css';
import '../styles/enter.css';

export const metadata: Metadata = { title: '氣mirror · Preparing your form', description: 'A quiet moment in ink before your tai chi lesson.' };

export default async function EnterPage({ searchParams }: { searchParams: Promise<{ form?: string | string[] }> }) {
  const query = await searchParams;
  const form = typeof query.form === 'string' && /^(?:[1-9]|1[0-9]|2[0-4])$/.test(query.form) ? Number(query.form) : 1;
  const clip = playlist.clips[form - 1];
  const sources = ['/practice-media/teaching-playlist.json', '/practice-media/24-playlist.json', clip.src, clip.referencePoseSrc];
  const resources = await Promise.all(sources.map(async src => ({ src, bytes: (await stat(path.join(process.cwd(), 'public', src))).size })));
  return <InkLoading plan={{ form, title: clip.title, chineseTitle: clip.chineseTitle, resources: resources as [typeof resources[number], typeof resources[number], typeof resources[number], typeof resources[number]] }} />;
}
