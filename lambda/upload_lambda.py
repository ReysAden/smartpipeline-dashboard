import json
import boto3
import uuid

s3 = boto3.client("s3")

BUCKET_NAME = "s3-smart-pipeline-bucket"

def lambda_handler(event, context):

    query_params = event.get("queryStringParameters") or {}

    file_name = query_params.get("fileName", "file")
    content_type = query_params.get(
        "contentType",
        "application/octet-stream"
    )

    key = f"uploads/{uuid.uuid4()}-{file_name}"

    upload_url = s3.generate_presigned_url(
        ClientMethod="put_object",
        Params={
            "Bucket": BUCKET_NAME,
            "Key": key,
            "ContentType": content_type
        },
        ExpiresIn=300
    )

    return {
        "statusCode": 200,
        "headers": {
            "Access-Control-Allow-Origin": "*"
        },
        "body": json.dumps({
            "uploadUrl": upload_url,
            "key": key
        })
    }