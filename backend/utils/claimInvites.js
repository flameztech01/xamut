// utils/claimInvites.js
//
// Promotes pending collaborator invites into real collaborations.
//
// The flow this file exists for:
//   1. Owner invites jane@x.com on a form. Jane has no Xamut account,
//      so a row is written to form.pendingCollaborators[]. Jane gets
//      an email with a signup link.
//   2. Jane signs up (or logs in if she already had an account but
//      the invite arrived after) using that same email.
//   3. This function runs on every successful authentication. It
//      finds any form whose pendingCollaborators list contains her
//      email, moves her into form.collaborators with the invited
//      role, and clears the pending row.
//
// Safe to call on every auth — it's a single indexed lookup that
// returns empty for the vast majority of users.

import Form from "../models/formModel.js";

/**
 * Promote all pending invites matching this user's email.
 *
 * @param {Object} user - Mongoose User document (or lean object) with _id and email.
 * @returns {Promise<{ claimed: number, forms: Array<{_id, title, role}> }>}
 */
export async function claimPendingCollaborations(user) {
  // No user context → nothing to claim.
  if (!user?._id || !user?.email) {
    return { claimed: 0, forms: [] };
  }

  const email = String(user.email).toLowerCase().trim();
  if (!email) return { claimed: 0, forms: [] };

  // Find every form that has a pending invite for this email.
  // Uses the `pendingCollaborators.email` index if it exists — otherwise
  // this is a fast enough scan for collections that aren't huge.
  const forms = await Form.find({
    "pendingCollaborators.email": email,
  });

  if (!forms.length) return { claimed: 0, forms: [] };

  const claimedForms = [];

  for (const form of forms) {
    const pending = (form.pendingCollaborators || []).find(
      (p) => p.email === email
    );
    if (!pending) continue;

    // Edge case: the owner invited their own email somehow. Just
    // clear the pending row and don't add them as a collaborator.
    if (String(form.owner) === String(user._id)) {
      form.pendingCollaborators = form.pendingCollaborators.filter(
        (p) => p.email !== email
      );
      await form.save();
      continue;
    }

    const alreadyCollab = form.collaborators.find(
      (c) => String(c.user) === String(user._id)
    );

    if (alreadyCollab) {
      // They're already a collaborator for some reason — possibly they
      // were added directly AND invited, or promoted earlier. Keep the
      // higher of the two roles.
      if (alreadyCollab.role !== "editor" && pending.role === "editor") {
        alreadyCollab.role = "editor";
      }
    } else {
      form.collaborators.push({
        user: user._id,
        role: pending.role,
        addedAt: new Date(),
      });
    }

    // Remove the pending row now that it's been promoted.
    form.pendingCollaborators = form.pendingCollaborators.filter(
      (p) => p.email !== email
    );

    await form.save();

    claimedForms.push({
      _id: form._id,
      title: form.title,
      role: pending.role,
    });

    console.log(
      `✅ Claimed invite for ${email} on "${form.title}" as ${pending.role}`
    );
  }

  return { claimed: claimedForms.length, forms: claimedForms };
}

export default { claimPendingCollaborations };