package audio

// SetBlobFault makes every blob write fail with fault() after the temp
// file is written, before it is renamed; nil removes the fault.
func SetBlobFault(fault func() error) { blobFault = fault }
