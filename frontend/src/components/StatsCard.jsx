import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

export default function StatsCard({ myData, topUserCount }) {
  if (!myData) return null;

  const percentage = topUserCount > 0 ? Math.round((myData.count / topUserCount) * 100) : 0;

  return (
    <Card className="mb-6 overflow-hidden !border-0 !bg-[#f8f8f8] !shadow-none">
      <CardContent className="flex flex-col items-stretch justify-between gap-6 p-5 md:flex-row md:items-center md:p-6">
        <div className="flex w-full items-center gap-4 rounded-2xl bg-white px-5 py-4 md:w-auto md:min-w-[300px]">
          <Avatar className="h-14 w-14">
            {myData.avatar && <AvatarImage src={myData.avatar} alt="Avatar" />}
            <AvatarFallback className="bg-[#f8f8f8] font-bold text-[#111F35]">自分</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="mb-0.5 text-xs font-bold tracking-wider text-[#111F35]">あなたの成績</p>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="result-number text-3xl font-bold leading-none text-gray-950">
                {myData.rank}
                <span className="ml-1 text-sm text-gray-500">位</span>
              </span>
              <span className="result-number text-sm text-gray-500">
                / {myData.count.toLocaleString()}件
              </span>
            </div>
          </div>
        </div>

        <div className="w-full md:w-1/2">
          <div className="mb-3 flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-base font-black text-black">
              1位との比較
            </span>
            <span className="result-number rounded-full bg-[#111F35] px-4 py-1.5 text-2xl font-black leading-none text-white">
              {percentage}%
            </span>
          </div>
          <div className="h-5 w-full overflow-hidden rounded-full bg-white">
            <div
              className="h-5 rounded-full bg-[#111F35] transition-all duration-1000 ease-out"
              style={{ width: `${Math.min(percentage, 100)}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between">
            <p className="font-mono text-sm font-black text-[#111F35]">自分</p>
            <p className="result-number text-right text-sm font-black text-[#111F35]">
              1位 ({topUserCount.toLocaleString()})
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
