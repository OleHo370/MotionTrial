import Review from '@/components/Review';
export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <Review id={id}/>; }
