import { DashboardStats } from '@/components/DashboardStats';
import { TextAnalyzer } from '@/components/TextAnalyzer';
import { Shield } from 'lucide-react';

import Link from 'next/link';

export default function Home() {
    return (
        <main className="min-h-screen bg-gray-50">
            <div className="container mx-auto p-8 max-w-6xl">
                <header className="mb-8 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-blue-600 rounded-lg text-white">
                            <Shield className="h-8 w-8" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900">Harmful Expression Filter</h1>
                            <p className="text-gray-500">Admin Dashboard</p>
                        </div>
                    </div>
                    <Link href="/logs" className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 transition-colors">
                        View Logs
                    </Link>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1">
                        <DashboardStats />
                    </div>
                    <div className="lg:col-span-2">
                        <TextAnalyzer />
                    </div>
                </div>
            </div>
        </main>
    );
}
