import SwiftUI

/// The athlete's plan at a glance: which one, how full, how long clips stay,
/// and what happens next with the subscription.
struct PlanSummary: View {
    let status: PlanStatus
    let color: PaletteColor

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(status.plan == .plus ? "Hop+" : "Free")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(status.plan == .plus ? color.color : Theme.ink)
                Spacer()
                Text("\(status.storage.usedBytes.storageText) of \(status.storage.limitBytes.storageText)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(Theme.muted)
            }

            ProgressView(value: status.usedFraction)
                .tint(gaugeTint)
                .accessibilityLabel(Text("Storage"))
                .accessibilityValue(Text("\(status.storage.usedBytes.storageText) of \(status.storage.limitBytes.storageText) used"))

            Label(retention, systemImage: "clock.arrow.circlepath")
                .font(.footnote)
                .foregroundStyle(Theme.muted)

            if let renewal {
                Label(renewal.text, systemImage: renewal.systemImage)
                    .font(.footnote)
                    .foregroundStyle(renewal.isWarning ? .orange : Theme.muted)
            }
        }
        .padding(.vertical, 4)
    }

    private var gaugeTint: Color {
        if status.isFull { return .red }
        if status.isNearlyFull { return .orange }
        return color.color
    }

    private var retention: String {
        guard let days = status.retentionDays else {
            return String(localized: "Clips are kept for good")
        }
        return String(localized: "Clips are kept \(days) days")
    }

    private var renewal: (text: String, systemImage: String, isWarning: Bool)? {
        guard let subscription = status.subscription else { return nil }
        if let grace = status.billingGraceEnds() {
            let date = grace.formatted(date: .abbreviated, time: .omitted)
            return (
                String(localized: "Your payment didn’t go through. Hop+ continues until \(date) while the App Store tries again."),
                "exclamationmark.triangle",
                true
            )
        }
        let date = Date(milliseconds: subscription.expiresAt).formatted(date: .abbreviated, time: .omitted)
        return subscription.autoRenew
            ? (String(localized: "Renews on \(date)"), "arrow.triangle.2.circlepath", false)
            : (String(localized: "Ends on \(date)"), "calendar", false)
    }
}

/// A word about Hop+ when the free plan is nearly full, at the top of the inbox.
struct StorageNudge: View {
    let status: PlanStatus
    let color: PaletteColor
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: status.isFull ? "externaldrive.badge.xmark" : "externaldrive.badge.exclamationmark")
                    .font(.title2)
                    .foregroundStyle(status.isFull ? .red : .orange)
                    .symbolRenderingMode(.hierarchical)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.muted)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect(cornerRadius: 22))
            .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22))
        }
        .buttonStyle(.plain)
    }

    private var title: String {
        if status.isFull { return String(localized: "Your Hop is full") }
        let percent = status.usedFraction.formatted(.percent.precision(.fractionLength(0)))
        return String(localized: "Your Hop is \(percent) full")
    }

    private var detail: String {
        let room = status.plans.plus.storageBytes.storageText
        return status.isFull
            ? String(localized: "New clips can’t arrive. Get Hop+ for \(room), kept for good.")
            : String(localized: "Get Hop+ for \(room), and every clip kept for good.")
    }
}
