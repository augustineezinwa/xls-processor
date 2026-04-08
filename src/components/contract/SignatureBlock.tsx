// ─── Signature block ──────────────────────────────────────────────────────────
function SignatureBlock({ label }: { label: string }) {
    return (
        <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-4">{label}</p>
            {["Name", "Signature", "Date"].map((field) => (
                <div key={field} className="mb-5">
                    <div className="flex items-end gap-2">
                        <span className="text-xs text-slate-500 w-20 shrink-0 pb-0.5">{field}:</span>
                        <div className="flex-1 border-b border-slate-400" style={{ minWidth: 0 }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

export default SignatureBlock;