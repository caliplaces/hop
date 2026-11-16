import SwiftUI

/// The athlete's plan at a glance: which one, how full, how long clips stay,
/// and what happens next with the subscription.
struct PlanSummary: View {
    let status: PlanStatus
    let color: PaletteColor

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                HStack(spacing: 6) {
                    Text(status.plan == .plus ? "Hop+" : "Free")
                        .font(.title3.weight(.bold))
                    if status.plan == .plus {
                        Image(systemName: "checkmark.seal.fill")
                            .foregroundStyle(color.color)
                            .accessibilityHidden(true)
                    }
                }
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
        // On either plan; only the inbox's nudge is for the free one.
        if status.usedFraction >= 0.8 { return .orange }
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
                subscription.isFromWebsite
                    ? String(localized: "Your payment didn’t go through. Hop+ continues until \(date) while it’s tried again. Update your card on the Hop website.")
                    : String(localized: "Your payment didn’t go through. Hop+ continues until \(date) while the App Store tries again."),
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

/// Free-plan clips about to go, at the top of the inbox: how many and when,
/// and Hop+ as the way to keep them (the reminders by email and on the phone
/// say the same). Tapping it opens Hop+.
struct ExpiryNudge: View {
    let expiring: PlanStatus.Expiring
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: "clock.badge.exclamationmark")
                    .font(.title2)
                    .foregroundStyle(.orange)
                    .symbolRenderingMode(.hierarchical)
                VStack(alignment: .leading, spacing: 3) {
                    Text(Self.title(expiring))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    Text("Save the ones you want, or get Hop+ to keep every clip for good.")
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

    /// "12 clips leave on 23 November", or "tomorrow" or "today" when
    /// that's the day here: the day the email named, in this calendar.
    nonisolated static func title(_ expiring: PlanStatus.Expiring, now: Date = .now, calendar: Calendar = .current) -> String {
        let day: String
        if let date = expiring.day(in: calendar) {
            // Past here already (far east of UTC), they're still there until it
            // has ended everywhere: today, then.
            day = date <= now
                ? String(localized: "today")
                : calendar.isDate(date, inSameDayAs: calendar.date(byAdding: .day, value: 1, to: now) ?? now)
                    ? String(localized: "tomorrow")
                    : String(localized: "on \(date.formatted(Date.FormatStyle(calendar: calendar, timeZone: calendar.timeZone).day().month(.wide)))")
        } else {
            day = String(localized: "soon")
        }
        return expiring.clips == 1
            ? String(localized: "1 clip leaves \(day)")
            : String(localized: "\(expiring.clips) clips leave \(day)")
    }
}
