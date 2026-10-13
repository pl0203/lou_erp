# Local PO document import

On **PO Baru**, choose **Import dokumen PO**, then select one file. The file is read in this browser using locally hosted reading/OCR assets. First use can take longer while those assets download. Originals, extracted text, previews and review decisions stay in the mounted form's memory. There is no attachment upload or saved import history.

## Supported inputs and limits

- One PDF, JPEG, PNG or static WebP, at most 10,000,000 bytes
- PDFs: at most five pages
- Images: at most 20 megapixels; preview/OCR longest edge is limited to 2400 pixels
- At most 100 source item rows; documents over the limit are rejected, never truncated
- One active read with a cancellable 120-second extraction deadline
- HEIC, animation, encrypted/unreadable PDFs, invalid signatures and unsafe metadata are rejected

The importer recognizes four supported table/indent layouts. Unknown, incomplete and multiple-PO documents require ordinary manual entry. OCR is fallible; review against the source even when values look plausible.

## Review before applying

1. Desktop shows the document and reviewed fields side by side. On mobile, use **Dokumen** and **Periksa data** tabs; arrow keys, Home and End switch tabs
2. Confirm the buyer customer. Supplier names, vendor codes and barcodes are source evidence, not ERP IDs
3. Check the PO number and order date. Missing dates need an explicit value. Expiry is optional and maps only to the existing PO expiry field, never delivery date
4. Check every source row separately. Select an authorized product or deliberately choose a manual item. Codes from buyer documents require an explicit product or manual choice, even when their text equals a catalog SKU. A unique suggestion has a one-click confirmation; name-only suggestions never silently replace a source SKU. Manual items do not create catalog master records
5. Check quantities, units and prices. There is no automatic unit, tax or currency conversion. Catalog-tier prices are reference values and do not replace document prices
6. Confirm units and IDR, and explicitly review the current financial warnings, including tax/total and catalog-tier differences or missing tier prices. These warnings appear before Apply; changing financial values/customer/catalog requires fresh review. Intrinsic integrity and invalid-value blockers cannot be cleared by ticking a warning box
7. A missing price may be deliberately left blank for completion in the ordinary form. It stays blank and normal Save validation still rejects it
8. Choose **Terapkan ke formulir**. Existing form edits require the usual discard confirmation. Canceling that confirmation preserves the form
9. Check the ordinary form and explicitly choose **Simpan PO**. Import, extraction, review and Apply do not submit a PO

Replacing or canceling a document releases its local reading work and previews. Leaving the page warns about unapplied import work; confirmed navigation discards it. Identity/role loss or a changed catalog invalidates the review. During catalog refresh or a pending Save, import actions are disabled. An old Apply confirmation cannot apply after a newer file, a review edit, a catalog/refetch change or an actor change; review and apply again after resolving the change.

This source guide does not certify physical-phone behavior or replace the final real-document browser acceptance record. No publication, deployment or production data submission is part of the local implementation.
