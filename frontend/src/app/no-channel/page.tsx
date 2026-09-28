import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";

export default function NoChannelPage() {
  return <main className="min-h-screen bg-background flex items-center justify-center p-6"><div className="bg-[#f8f8f8] p-10 rounded-2xl max-w-md w-full text-center"><div className="w-16 h-16 bg-white text-[#111F35] rounded-2xl flex items-center justify-center mx-auto mb-6"><SearchX className="w-10 h-10" /></div><p className="text-xs font-black text-gray-400 uppercase tracking-[0.24em] mb-2">Oops!!</p><h1 className="text-2xl font-black text-gray-900 mb-4">データがありません</h1><p className="text-sm text-gray-500 mb-8 leading-relaxed">この時、このチャンネルは存在してなかったようです...</p><Link href="/" className="w-full py-4 bg-gray-900 text-white font-bold rounded-2xl hover:bg-black transition-all flex items-center justify-center gap-2"><ArrowLeft className="w-4 h-4" />戻る</Link></div></main>;
}
