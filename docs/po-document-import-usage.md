# Local PO document import

On **PO Baru**, choose **Import dokumen PO**, then select one file. The file is read in this browser using locally hosted reading/OCR assets. First use can take longer while those assets download. Originals, extracted text, previews and review decisions stay in the mounted form's memory. There is no attachment upload or saved import history.

## Supported inputs and limits

- One PDF, JPEG, PNG or static WebP, at most 10,000,000 bytes
- PDFs: at most five pages
- Images: at most 20 megapixels; preview/OCR longest edge is limited to 2400 pixels
- At most 100 source item rows; documents over the limit are rejected, never truncated
- One active read with a cancellable 120-second extraction deadline
- HEIC, animation, encrypted/unreadable PDFs, invalid signatures and unsafe metadata are rejected

The importer recognizes four supported table/indent layouts. Unknown, incomplete and multiple-PO documents require ordinary manual entry. Text can be successfully read while table structure or row completeness remains unreliable; that state is explained separately from a document with no readable text. The importer does not relax integrity checks or fill partial lines. OCR is fallible; review against the source even when values look plausible.

## Review before applying

1. Desktop shows the document and reviewed fields side by side. On mobile, use **Dokumen** and **Periksa data** tabs; arrow keys, Home and End switch tabs
2. Confirm the buyer customer. Supplier names, vendor codes and barcodes are source evidence, not ERP IDs
3. Check the PO number and order date. Missing dates need an explicit value. Expiry is optional and maps only to the existing PO expiry field, never delivery date
4. Check every source row separately. Select an authorized product. Exact SKU text matches appear first, followed by up to five ranked description/size/model suggestions with individual choice buttons. The 0–100 score is weighted text overlap, not a probability or assurance of identity. Numeric/model disagreements reduce the score and are flagged when shown. SKU punctuation, leading zeros and internal spaces remain significant. Codes from buyer documents require an explicit catalog-product choice, even when their text equals a catalog SKU; barcodes are not treated as ERP SKUs. Only the existing trusted-code path can preselect a unique exact SKU, and duplicate normalized codes never auto-select. All four current document layouts mark their buyer codes for explicit choice. Name-only and similarity suggestions never silently replace a source SKU. Use the full product lookup if none of the five suggestions is appropriate. Imported rows cannot create manual items or catalog master records
5. Check quantities, units and prices. There is no automatic unit, tax or currency conversion. Extracted document prices prefill editable fields for PO Admin to review; catalog tiers never supply or replace prices
6. Confirm units, and explicitly review the current financial warnings, including tax, line totals, document totals and unsupported charges. Missing currency defaults to IDR for this Indonesia-only business, without a confirmation checkbox; explicitly foreign currency remains blocked rather than converted. These warnings appear before Apply; changing financial values/customer/catalog requires fresh review. Intrinsic integrity and invalid-value blockers cannot be cleared by ticking a warning box
7. A missing price may be deliberately left blank for completion in the ordinary form. It stays blank and normal Save validation still rejects it
8. Choose **Terapkan ke formulir**. Its red summary lists only unresolved blockers, not informational source warnings. Existing form edits require the usual discard confirmation. Canceling that confirmation preserves the form
9. Check the ordinary form and explicitly choose **Simpan PO**. Import, extraction, review and Apply do not submit a PO

Replacing or canceling a document releases its local reading work and previews. Leaving the page warns about unapplied import work; confirmed navigation discards it. Identity/role loss or a changed catalog invalidates the review. During catalog refresh or a pending Save, import actions are disabled. A temporary unavailable/refetch state retains the local document and review; unchanged verified data resumes it. A failed refresh keeps the review but cannot apply stale choices. Actual catalog changes still invalidate it. An old Apply confirmation cannot apply after a newer file, a review edit, a catalog/refetch change or an actor change; review and apply again after resolving the change.

This source guide does not certify physical-phone behavior or replace the final real-document browser acceptance record. No publication, deployment or production data submission is part of the local implementation.
