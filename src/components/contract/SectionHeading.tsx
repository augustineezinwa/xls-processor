function SectionHeading({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-3 my-6">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 shrink-0">
                {children}
            </span>
            <div className="h-px flex-1 bg-slate-200" />
        </div>
    );
}

export default SectionHeading;