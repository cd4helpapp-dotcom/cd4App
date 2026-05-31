import sys

def verify_png(filepath):
    try:
        with open(filepath, 'rb') as f:
            header = f.read(8)
            # PNG signature: 89 50 4E 47 0D 0A 1A 0A
            expected_header = b'\x89\x50\x4e\x47\x0d\x0a\x1a\x0a'
            if header != expected_header:
                print(f"INVALID_HEADER: {header.hex()}")
                return
            print("VALID_PNG_HEADER")
            
            # optional: check chunks loop
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        verify_png(sys.argv[1])
