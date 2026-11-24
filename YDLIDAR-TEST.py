import serial
import struct
import time

port = "COM4"
baud = 230400  # T-mini Plus standard baud rate

try:
    ser = serial.Serial(port, baud, timeout=1)
    time.sleep(0.5)

    # Clear any old data and send Start Scan command (0xA5 0x60)
    ser.reset_input_buffer()
    ser.write(b'\xA5\x60')
    print("Sent start command to YDLIDAR T-mini Plus...")

    start_time = time.time()
    packets_read = 0

    while (time.time() - start_time) < 5:
        # Look for packet header 0xAA 0x55 (little-endian 0x55AA)
        if ser.read(1) == b'\xAA' and ser.read(1) == b'\x55':
            header = ser.read(8)
            if len(header) < 8:
                continue

            ct, lsn, fsa, lsa, cs = struct.unpack('<BBHHH', header)
            # T-mini Plus uses 3 bytes per sample (1B intensity + 2B distance)
            sample_data = ser.read(lsn * 3)

            if len(sample_data) == lsn * 3 and (ct & 0x01) == 0 and lsn > 0:
                # Calculate start angle and first sample distance (in mm)
                start_angle = (fsa >> 1) / 64.0
                intensity = sample_data[0]
                distance_mm = struct.unpack('<H', sample_data[1:3])[0]

                packets_read += 1
                if packets_read % 15 == 0:  # Print every 15th packet so Shell stays readable
                    print(f"Angle: {start_angle:6.2f}° | Distance: {distance_mm:5d} mm | Intensity: {intensity}")

    # Send Stop Scan command (0xA5 0x65) so the motor stops spinning
    ser.write(b'\xA5\x65')
    ser.close()
    print(f"Done! Successfully read {packets_read} scan packets.")

except Exception as e:
    print("Error:", e)
