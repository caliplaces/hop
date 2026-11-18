package com.onmyhop.app

import androidx.compose.ui.geometry.Offset
import com.onmyhop.app.core.PlanStatus
import com.onmyhop.app.feature.account.BillingNote
import com.onmyhop.app.feature.myhop.TiltMath
import org.junit.Assert.assertEquals
import org.junit.Test

class AccountTest {
    private fun plan(plan: String, subscription: PlanStatus.Subscription? = null) =
        PlanStatus(plan = plan, storage = PlanStatus.Storage(0, 1), subscription = subscription)

    /** A paying athlete must hear that Apple keeps billing; the website's Hop+ ends with the account. */
    @Test
    fun deletingSaysWhatHappensToHopPlus() {
        assertEquals(BillingNote.Unknown, BillingNote.forPlan(null))
        assertEquals(BillingNote.None, BillingNote.forPlan(plan("free")))
        assertEquals(BillingNote.Renews, BillingNote.forPlan(plan("plus", PlanStatus.Subscription("apple", 1, null, autoRenew = true))))
        assertEquals(BillingNote.None, BillingNote.forPlan(plan("plus", PlanStatus.Subscription("apple", 1, null, autoRenew = false))))
        assertEquals(BillingNote.EndsWithAccount, BillingNote.forPlan(plan("plus", PlanStatus.Subscription("stripe", 1, null, autoRenew = true))))
    }

    /** Tilt is relative to how the phone is held, clamped, and settles back slowly. */
    @Test
    fun tiltFollowsTheRestingPose() {
        val (tilt, rest) = TiltMath.step(Offset(0.35f, -0.7f), Offset.Zero)
        assertEquals(1f, tilt.x, 1e-5f)
        assertEquals(-1f, tilt.y, 1e-5f)
        assertEquals(0.35f * TiltMath.SETTLE, rest.x, 1e-5f)
        val (still, _) = TiltMath.step(Offset(0.2f, 0.2f), Offset(0.2f, 0.2f))
        assertEquals(Offset.Zero, still)
    }
}
