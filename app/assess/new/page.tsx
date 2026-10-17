import CaptureFlow from '@/components/CaptureFlow';
export default async function NewAssessment({ searchParams }: { searchParams: Promise<{ parent?: string }> }) {
 const { parent } = await searchParams;
 return <CaptureFlow parentSessionId={parent}/>;
}
