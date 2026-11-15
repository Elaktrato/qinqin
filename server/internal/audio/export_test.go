package audio

// SetBlobFault makes every blob write fail with fault() after the temp
// file is written, before it is renamed; nil removes the fault.
func SetBlobFault(fault func() error) { blobFault = fault }

// StoreBlobForTest runs storeBlob on a file with a claimed hash.
func StoreBlobForTest(store, path, sha, ext string, size int64) error {
	return storeBlob(store, clipFile{path: path, sha: sha, ext: ext, size: size})
}

// MaxSyllableQueries is the per-request cap of distinct syllable lookups.
const MaxSyllableQueries = maxSyllableQueries
